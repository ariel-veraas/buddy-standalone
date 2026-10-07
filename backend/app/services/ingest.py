"""Indexar documentos: guardar, partir en fragmentos, conservar vectores de lo que no cambió y sincronizar Drive."""
import hashlib
import logging
import threading
import time
from collections import Counter
from datetime import timedelta

from sqlalchemy import delete, select

from .. import models
from ..core import vectors
from ..core.chunker import split_text_ex, strip_toc
from ..core.drive_client import DriveClient, DriveError, parse_service_account
from ..core.chunker import MAX_CHUNKS_PER_DOCUMENT
from ..core.text import search_context, strip_control_chars
from ..models import Chunk, Collection, Document, now
from . import settings as S

log = logging.getLogger("buddy.ingest")
SYNC_BUDGET_SECONDS = 600
STUCK_AFTER = timedelta(minutes=45)
RETRY_AFTER_ERROR = timedelta(hours=1)
FATAL_CODES = {"auth", "forbidden", "disabled", "quota", "rate_limited"}
_sync_lock = threading.Lock()
_running: set[int] = set()


def _clean(value):
    return strip_control_chars(value) if isinstance(value, str) else value


def replace_document(db, collection, *, external_id, name, path="", mime="", link="", modified="", stamp="",
                     text=None, state="ready", error=None):
    """Crea o reemplaza un documento y sus fragmentos. Los fragmentos cuyo texto no cambió conservan su vector."""
    doc = db.scalar(select(Document).where(Document.collection_id == collection.id, Document.external_id == external_id))
    old_vectors = {}
    if doc is None:
        doc = Document(collection_id=collection.id, external_id=external_id, name="")
        db.add(doc)
    else:
        for chunk in db.scalars(select(Chunk).where(Chunk.document_id == doc.id, Chunk.embedding.is_not(None))):
            old_vectors[chunk.embedding_hash] = (chunk.embedding, chunk.embedding_model)
        db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    doc.name, doc.path, doc.mime = _clean(name)[:300], (_clean(path) or "")[:600], (_clean(mime) or "")[:120]
    doc.web_view_link, doc.modified_time, doc.stamp = (_clean(link) or "")[:600], (_clean(modified) or "")[:40], (stamp or "")[:200]
    pieces, cut = ([], False)
    if text:
        pieces, cut = split_text_ex(strip_toc(_clean(text)))
        if not pieces:
            state = "skipped"
        elif cut:
            error = error or f"Documento truncado a {MAX_CHUNKS_PER_DOCUMENT} fragmentos: se indexó solo el comienzo."
    elif state == "ready":
        state = "skipped"
    doc.state, doc.error = state, error
    db.flush()
    context = search_context(doc.name, doc.path, collection.name)
    for index, piece in enumerate(pieces):
        chunk = Chunk(document_id=doc.id, collection_id=collection.id, sequence=index, content=piece, context_text=context)
        digest = vectors.text_hash(vectors.embedding_text(context, piece))
        if digest in old_vectors:
            chunk.embedding, chunk.embedding_model = old_vectors[digest]
            chunk.embedding_hash = digest
        db.add(chunk)
    return doc, state


def add_upload(db, collection, filename, data, extractor):
    """Un archivo subido. `extractor(filename, data) -> (texto, truncado)`. Reemplaza el anterior con el mismo nombre."""
    name = _clean(filename.replace("\\", "/").rsplit("/", 1)[-1]).strip() or "documento"
    stamp = hashlib.sha256(data).hexdigest()
    external_id = "up:" + name.lower()[:190]
    existing = db.scalar(select(Document).where(Document.collection_id == collection.id, Document.external_id == external_id))
    if existing is not None and existing.stamp == stamp and existing.state != "error":
        return existing, "unchanged"
    try:
        text, truncated = extractor(name, data)
    except Exception as exc:  # noqa: BLE001 - un archivo roto no frena la subida de los demás
        doc, _ = replace_document(db, collection, external_id=external_id, name=name, stamp=stamp, state="error",
                                  error=_clean(str(exc))[:240])
        return doc, "error"
    error = "Documento truncado: se leyó solo la primera parte (límite de páginas o de tamaño)." if truncated else None
    doc, state = replace_document(db, collection, external_id=external_id, name=name, mime="", stamp=stamp, text=text, error=error)
    return doc, "updated" if state == "ready" else state


# ---- Google Drive -------------------------------------------------------------------------------------------------

def _file_stamp(f):
    return "%s|%s" % (f.modified_time or "", f.md5 or "")


def sync_drive(db_factory, collection_id, deadline=None, client=None):
    """Sincroniza una colección de Drive. Devuelve el resumen. Corre en un hilo aparte (nunca dentro de un pedido web)."""
    with _sync_lock:
        if collection_id in _running:
            return None
        _running.add(collection_id)
    try:
        return _sync_drive(db_factory, collection_id, deadline or time.monotonic() + SYNC_BUDGET_SECONDS, client)
    finally:
        with _sync_lock:
            _running.discard(collection_id)


def _sync_drive(db_factory, collection_id, deadline, client):
    stats = Counter()
    with db_factory() as db:
        collection = db.get(Collection, collection_id)
        if collection is None or collection.kind != "drive":
            return None
        collection.state, collection.error = "syncing", None
        db.commit()
        try:
            if client is None:
                raw = S.raw(db, "drive_key")
                if not raw:
                    raise DriveError("not_configured", "Primero cargá la clave de Google Drive en Ajustes.")
                client = DriveClient(parse_service_account(raw))
            files = client.list_folder(collection.drive_folder)
            known = {d.external_id: d for d in db.scalars(select(Document).where(Document.collection_id == collection.id))}
            seen, pending = set(), False
            for f in files:
                seen.add(f.id)
                doc = known.get(f.id)
                if doc and doc.stamp == _file_stamp(f) and doc.state != "error":
                    stats["unchanged"] += 1
                    continue
                if time.monotonic() > deadline:
                    pending = True
                    break
                state, error, text = "ready", None, None
                try:
                    text = client.fetch_text(f)
                    if getattr(client, "last_fetch_truncated", False):
                        error = "Documento truncado: se leyó solo la primera parte (límite de páginas o de tamaño)."
                except DriveError as exc:
                    if exc.code in FATAL_CODES:
                        raise
                    state, error = "error", _clean(str(exc))[:240]
                _, final = replace_document(db, collection, external_id=f.id, name=f.name, path=f.path, mime=f.mime_type,
                                            link=f.web_view_link or "", modified=f.modified_time, stamp=_file_stamp(f),
                                            text=text, state=state, error=error)
                stats[{"ready": "updated", "skipped": "empty", "error": "failed"}[final]] += 1
                db.commit()
            if not pending and not getattr(client, "truncated", False):
                stale = [d for external, d in known.items() if external not in seen]
                for d in stale:
                    db.delete(d)
                stats["removed"] = len(stale)
            collection.state = "idle"
            collection.last_sync = now()
            if pending:
                collection.error = "Continúa en la próxima pasada."
            db.commit()
        except DriveError as exc:
            db.rollback()
            collection = db.get(Collection, collection_id)
            collection.state, collection.error = "error", _clean(str(exc))[:400]
            db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("Sincronización de la colección %s falló (%s)", collection_id, type(exc).__name__)
            db.rollback()
            collection = db.get(Collection, collection_id)
            collection.state = "error"
            collection.error = "Falló la sincronización por un error inesperado. Revisá el registro del servidor."
            db.commit()
    return dict(stats)


def due_collections(db, hours):
    """Colecciones de Drive que toca sincronizar ahora."""
    out, current = [], now()
    for c in db.scalars(select(Collection).where(Collection.kind == "drive", Collection.active.is_(True))):
        if c.state == "syncing":
            if c.last_sync is None or c.last_sync + STUCK_AFTER <= current:
                if c.id not in _running:
                    out.append(c.id)
        elif c.state == "error":
            if c.last_sync is None or c.last_sync + RETRY_AFTER_ERROR <= current:
                out.append(c.id)
        elif c.last_sync is None or c.last_sync + timedelta(hours=max(1, hours)) <= current:
            out.append(c.id)
    return out


def scheduler(stop: threading.Event, interval=300):
    """Hilo de fondo: cada 5 minutos mira qué colecciones de Drive toca sincronizar."""
    while not stop.wait(interval):
        try:
            from . import growth
            with models.session() as db:
                growth.daily(db, scheduled=True)
                db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("Planificador de crecimiento: %s", type(exc).__name__)
        try:
            with models.session() as db:
                growth.weekly(db, scheduled=True)
                db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("Planificador de entrenamiento: %s", type(exc).__name__)
        try:
            from . import maintenance
            with models.session() as db:
                maintenance.purge(db)
                hours = int(S.raw(db, "sync_hours") or 24)
                due = due_collections(db, hours)
            for cid in due:
                sync_drive(models.session, cid)
        except Exception as exc:  # noqa: BLE001
            log.warning("Planificador de sincronización: %s", type(exc).__name__)
