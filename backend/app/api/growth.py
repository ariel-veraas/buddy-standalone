import re
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import auth as A
from ..services import growth as G
from ..services import ingest, extract, settings as S, quality
from ..models import Draft, SynonymProposal, Collection, Ticket, EvalCase
from ..core import text as T, digest_logic as D

router = APIRouter(prefix="/api/growth")


@router.get("")
def overview(ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    return {**G.status(db), "last_daily": G.last_daily(db)}


@router.post("/run")
def run(request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    """Verifica mejoras sin IA y registra quién pidió la corrida."""
    summary = G.daily(db)
    A.audit(db, ctx.user, "growth_run", f"{summary['passed']}/{summary['total']}", request)
    db.commit()
    return summary


@router.get("/dex")
def dex(ctx=Depends(A.staff), db=Depends(A.get_db)):
    return G.dex(db)


@router.get("/weekly")
def weekly(ctx=Depends(A.staff), db=Depends(A.get_db)):
    return G.weekly_view(db)


@router.post("/weekly/run")
def weekly_run(request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    result = G.weekly(db)
    A.audit(db, ctx.user, "growth_weekly_run", result["week"], request)
    db.commit()
    return result


def draft_view(row):
    return {k: getattr(row, k) for k in ("id", "created_at", "ticket_id", "title", "body", "state", "document_id")}


@router.get("/drafts")
def drafts(state: str = "pending", ctx=Depends(A.staff), db=Depends(A.get_db)):
    if state not in ("pending", "approved", "rejected"):
        raise HTTPException(422, "Estado inválido.")
    return [draft_view(d) for d in db.scalars(select(Draft).where(Draft.state == state).order_by(Draft.id.desc()))]


class DraftPatch(BaseModel):
    state: str
    title: str | None = Field(default=None, min_length=1, max_length=300)
    body: str | None = Field(default=None, min_length=1, max_length=6000)
    collection_id: int | None = None


@router.put("/drafts/{draft_id}")
def update_draft(draft_id: int, data: DraftPatch, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    row = db.scalar(select(Draft).where(Draft.id == draft_id).with_for_update())
    if not row:
        raise HTTPException(404, "No existe ese borrador.")
    if data.state not in ("approved", "rejected"):
        raise HTTPException(422, "Elegí aprobar o rechazar.")
    if row.state != "pending":
        if row.state == data.state:
            return draft_view(row)
        raise HTTPException(409, "El borrador ya fue revisado.")
    if data.state == "approved":
        collection = db.get(Collection, data.collection_id) if data.collection_id is not None else None
        if not collection:
            raise HTTPException(422, "Elegí una colección para el documento.")
        # Misma autorización de edición que las subidas manuales: staff puede editar upload.
        if not collection.active or collection.kind != "upload":
            raise HTTPException(403, "Elegí una colección manual activa que puedas editar.")
        title, body = (data.title if data.title is not None else row.title).strip(), (data.body if data.body is not None else row.body).strip()
        if not title or not body:
            raise HTTPException(422, "El título y el texto no pueden quedar vacíos.")
        row.title, row.body = T.strip_control_chars(title), T.strip_control_chars(body)
        slug = re.sub(r"[^\w -]", "", row.title)[:100].strip() or "documento"
        doc, result = ingest.add_upload(db, collection, f"borrador-{row.id}-{slug}.txt",
                                       row.body.encode("utf-8"), extract.extract_text)
        if doc.state != "ready":
            raise HTTPException(422, "El texto no pudo indexarse. Revisá el borrador.")
        row.document_id = doc.id
        ticket = db.get(Ticket, row.ticket_id)
        question = G.ticket_question(db, ticket)
        if not question.strip():
            raise HTTPException(422, "Falta la pregunta humana original del ticket.")
        db.add(EvalCase(question=question[:500], document_id=doc.id, origin="gap"))
        for key, _ in D.question_keys(question):
            quality.set_gap(db, key, "resolved", row.title)
        # La aprobación no da XP: daily concede topic_verified solo cuando el caso pasa.
    row.state = data.state
    A.audit(db, ctx.user, "growth_draft_" + data.state, str(row.id), request)
    db.commit()
    return draft_view(row)


def synonym_view(row):
    return {k: getattr(row, k) for k in ("id", "term", "suggested", "count", "state")}


@router.get("/synonyms")
def synonyms(state: str = "pending", ctx=Depends(A.staff), db=Depends(A.get_db)):
    if state not in ("pending", "approved", "rejected"):
        raise HTTPException(422, "Estado inválido.")
    return [synonym_view(s) for s in db.scalars(select(SynonymProposal).where(SynonymProposal.state == state)
                                              .order_by(SynonymProposal.count.desc(), SynonymProposal.id))]


class SynonymPatch(BaseModel):
    state: str


@router.put("/synonyms/{proposal_id}")
def update_synonym(proposal_id: int, data: SynonymPatch, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    row = db.scalar(select(SynonymProposal).where(SynonymProposal.id == proposal_id).with_for_update())
    if not row:
        raise HTTPException(404, "No existe esa propuesta.")
    if data.state not in ("approved", "rejected"):
        raise HTTPException(422, "Elegí aprobar o rechazar.")
    if row.state != "pending":
        if row.state == data.state:
            return synonym_view(row)
        raise HTTPException(409, "La propuesta ya fue revisada.")
    if data.state == "approved":
        db.execute(G.text("SELECT pg_advisory_xact_lock(7005)"))
        raw = S.raw(db, "synonyms")
        updated = (raw + "\n" + row.term + ", " + row.suggested).strip()
        try:
            T.validate_synonyms(updated)
            S.set_many(db, {"synonyms": updated})
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    row.state = data.state
    A.audit(db, ctx.user, "growth_synonym_" + data.state, str(row.id), request)
    db.commit()
    return synonym_view(row)
