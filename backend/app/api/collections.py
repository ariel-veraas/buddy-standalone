import threading

from starlette.concurrency import run_in_threadpool

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import auth as A, config, models
from ..core.drive_client import DriveError, parse_folder_id
from ..models import Chunk, Collection, Document, Group
from ..services import extract, ingest

router = APIRouter(prefix="/api/collections")
MAX_FILES_PER_UPLOAD = 10
MAX_TOTAL_UPLOAD = 60 * 1024 * 1024


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = "upload"
    drive_folder: str | None = Field(default=None, max_length=300)
    visibility: str = "groups"
    group_ids: list[int] = []
    active: bool = True


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    drive_folder: str | None = Field(default=None, max_length=300)
    visibility: str | None = None
    group_ids: list[int] | None = None
    active: bool | None = None


def view(db, c):
    docs = db.scalar(select(func.count(Document.id)).where(Document.collection_id == c.id))
    errors = db.scalar(select(func.count(Document.id)).where(Document.collection_id == c.id, Document.state == "error"))
    chunks = db.scalar(select(func.count(Chunk.id)).where(Chunk.collection_id == c.id))
    return {"id": c.id, "name": c.name, "kind": c.kind, "drive_folder": c.drive_folder, "active": c.active,
            "visibility": c.visibility, "state": c.state, "error": c.error, "last_sync": c.last_sync,
            "documents": docs, "documents_with_errors": errors, "chunks": chunks,
            "groups": [{"id": g.id, "name": g.name} for g in c.groups]}


def _check(data_visibility, kind=None, folder=None):
    if data_visibility not in ("all", "groups"):
        raise HTTPException(422, "Visibilidad inválida.")
    if kind is not None and kind not in ("upload", "drive"):
        raise HTTPException(422, "Tipo inválido.")
    if kind == "drive":
        try:
            return parse_folder_id(folder or "")
        except (DriveError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc
    return None


def _groups(db, ids):
    groups = list(db.scalars(select(Group).where(Group.id.in_(ids)))) if ids else []
    if len(groups) != len(set(ids)):
        raise HTTPException(422, "Algún grupo no existe.")
    return groups


def _get(db, collection_id):
    c = db.get(Collection, collection_id)
    if not c:
        raise HTTPException(404, "No existe esa colección.")
    return c


@router.get("")
def list_collections(ctx=Depends(A.staff), db=Depends(A.get_db)):
    return [view(db, c) for c in db.scalars(select(Collection).order_by(Collection.name))]


@router.post("")
def create(data: CollectionIn, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    if ctx.user.role != "admin":
        # Un editor sube documentos, pero qué se publica y a quién (Drive, visibilidad, grupos) lo decide un administrador.
        if data.kind != "upload" or data.visibility != "groups" or data.group_ids:
            raise HTTPException(403, "Solo un administrador puede conectar Drive o abrir una colección a otras personas.")
    folder = _check(data.visibility, data.kind, data.drive_folder)
    c = Collection(name=data.name.strip(), kind=data.kind, drive_folder=folder, visibility=data.visibility,
                   active=data.active, groups=_groups(db, data.group_ids), state="idle")
    db.add(c)
    A.audit(db, ctx.user, "collection_created", c.name, request)
    db.commit()
    return view(db, c)


@router.patch("/{collection_id}")
def update(collection_id: int, data: CollectionPatch, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    c = _get(db, collection_id)
    if ctx.user.role != "admin" and (data.visibility is not None or data.group_ids is not None or data.drive_folder is not None
                                      or data.active is not None):
        raise HTTPException(403, "Solo un administrador puede cambiar quién ve la colección, su carpeta de Drive o pausarla.")
    if data.visibility is not None:
        _check(data.visibility)
        c.visibility = data.visibility
    if data.drive_folder is not None and c.kind == "drive":
        c.drive_folder = _check("all", "drive", data.drive_folder)
        c.last_sync = None
    if data.name is not None:
        c.name = data.name.strip()
    if data.active is not None:
        c.active = data.active
    if data.group_ids is not None:
        c.groups = _groups(db, data.group_ids)
    db.flush()
    if data.name is not None:
        _refresh_context(db, c)
    # Cambió quién puede leer: las conversaciones de TODOS pueden contener texto que ya no deberían ver.
    if data.visibility is not None or data.group_ids is not None or data.active is not None:
        db.execute(models.User.__table__.update().values(perm_version=models.User.perm_version + 1))
    A.audit(db, ctx.user, "collection_updated", c.name, request)
    db.commit()
    return view(db, c)


def _refresh_context(db, c):
    from ..core.text import search_context
    for d in db.scalars(select(Document).where(Document.collection_id == c.id)):
        db.query(Chunk).filter(Chunk.document_id == d.id).update({"context_text": search_context(d.name, d.path, c.name)})


@router.delete("/{collection_id}")
def delete(collection_id: int, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    c = _get(db, collection_id)
    A.audit(db, ctx.user, "collection_deleted", c.name, request)
    db.delete(c)
    db.execute(models.User.__table__.update().values(perm_version=models.User.perm_version + 1))
    db.commit()
    return {"ok": True}


@router.get("/{collection_id}/documents")
def documents(collection_id: int, ctx=Depends(A.staff), db=Depends(A.get_db)):
    _get(db, collection_id)
    counts = dict(db.execute(select(Chunk.document_id, func.count(Chunk.id)).where(Chunk.collection_id == collection_id)
                             .group_by(Chunk.document_id)).all())
    rows = db.scalars(select(Document).where(Document.collection_id == collection_id).order_by(Document.path, Document.name))
    return [{"id": d.id, "name": d.name, "path": d.path, "state": d.state, "error": d.error, "chunks": counts.get(d.id, 0),
             "modified": d.modified_time, "link": d.web_view_link} for d in rows]


@router.delete("/{collection_id}/documents/{document_id}")
def delete_document(collection_id: int, document_id: int, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    d = db.get(Document, document_id)
    if not d or d.collection_id != collection_id:
        raise HTTPException(404, "No existe ese documento.")
    A.audit(db, ctx.user, "document_deleted", d.name, request)
    db.delete(d)
    db.commit()
    return {"ok": True}


@router.post("/{collection_id}/upload")
async def upload(collection_id: int, request: Request, files: list[UploadFile] = File(...), ctx=Depends(A.staff), db=Depends(A.get_db)):
    c = _get(db, collection_id)
    if c.kind != "upload":
        raise HTTPException(409, "Esta colección se sincroniza con Drive: no admite subir archivos.")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(413, f"Subí hasta {MAX_FILES_PER_UPLOAD} archivos por vez.")
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    loaded, total = [], 0
    for f in files:
        data = await f.read(limit + 1)
        total += len(data)
        if total > MAX_TOTAL_UPLOAD:
            raise HTTPException(413, f"Entre todos los archivos pasan el máximo de {MAX_TOTAL_UPLOAD // (1024 * 1024)} MB por vez.")
        loaded.append((f.filename or "documento", data))
    return await run_in_threadpool(_index_uploads, request, c.id, loaded, ctx.user.id)


def _index_uploads(request, collection_id, loaded, actor_id):
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    results = []
    with models.session() as db:
        c = db.get(Collection, collection_id)
        for name, data in loaded:
            if len(data) > limit:
                results.append({"name": name, "result": "error", "error": f"Supera el máximo de {config.MAX_UPLOAD_MB} MB."})
                continue
            doc, state = ingest.add_upload(db, c, name, data, extract.extract_text)
            results.append({"name": doc.name, "result": state, "error": doc.error})
        db.add(models.AuditLog(actor_id=actor_id, action="documents_uploaded", detail=f"{c.name}: {len(loaded)} archivo(s)",
                               ip=A.client_ip(request)))
        db.commit()
    return {"results": results}


@router.post("/{collection_id}/sync")
def sync(collection_id: int, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    c = _get(db, collection_id)
    if c.kind != "drive":
        raise HTTPException(409, "Solo las colecciones de Drive se sincronizan.")
    if c.state == "syncing":
        raise HTTPException(409, "Ya se está sincronizando.")
    c.state, c.error = "syncing", None
    db.commit()
    threading.Thread(target=ingest.sync_drive, args=(models.session, collection_id), daemon=True).start()
    return {"ok": True}
