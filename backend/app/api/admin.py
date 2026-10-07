import threading
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import auth as A, models
from ..core.drive_client import DriveError, parse_service_account
from ..core.provider import PROVIDERS, ProviderError, supports_embeddings
from ..models import Contact, Feedback, Insight, Message, Ticket, User, now
from ..services import chat as C, embed, settings as S

router = APIRouter(prefix="/api/admin")


# ---- Ajustes ----------------------------------------------------------------------------------------------------

@router.get("/settings")
def get_settings(ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    values = S.get_all(db)
    values["providers"] = {k: v[0] for k, v in PROVIDERS.items()}
    values["drive_email"] = ""
    raw = S.raw(db, "drive_key") if values["drive_key_set"] else ""
    if raw:
        try:
            values["drive_email"] = parse_service_account(raw).get("client_email", "")
        except DriveError:
            pass
    return values


@router.put("/settings")
def put_settings(data: dict, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    if "drive_key" in data and data["drive_key"]:
        try:
            parse_service_account(str(data["drive_key"]))
        except DriveError as exc:
            raise HTTPException(422, str(exc)) from exc
    try:
        S.set_many(db, {k: v for k, v in data.items() if k not in ("providers", "api_key_set", "drive_key_set", "drive_email")})
    except S.SettingsError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    A.audit(db, ctx.user, "settings_changed", ", ".join(sorted(k for k in data if k not in ("api_key", "drive_key")))[:300], request)
    db.commit()
    return get_settings(ctx, db)


@router.delete("/settings/secret/{key}")
def clear_secret(key: str, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    try:
        S.clear_secret(db, key)
    except S.SettingsError as exc:
        raise HTTPException(404, str(exc)) from exc
    A.audit(db, ctx.user, "secret_removed", key, request)
    db.commit()
    return {"ok": True}


@router.post("/settings/test")
def test_connection(ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    """Prueba el proveedor con la configuración guardada: lista modelos y hace una consulta mínima."""
    if not S.raw(db, "api_key"):
        raise HTTPException(409, "Primero cargá la API key.")
    provider = C.provider_for(models.session)
    model = S.engine_cfg(db)["chat_model"]
    try:
        names = provider._list_models(15)
    except Exception as exc:  # noqa: BLE001
        names = []
        listing_error = getattr(exc, "code", type(exc).__name__)
    else:
        listing_error = None
    try:
        reply = provider._chat(model, [{"role": "user", "content": "Respondé solo: ok"}], 20, max_tokens=16)
        return {"ok": True, "model": model, "reply": str(reply)[:80], "models": names[:12], "listing_error": listing_error}
    except ProviderError as exc:
        return {"ok": False, "error": exc.code, "message": str(exc), "models": names[:12]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": type(exc).__name__, "message": "No pude completar la prueba.", "models": names[:12]}


@router.get("/semantic")
def semantic_status(ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    cfg = embed.semantic_cfg(db)
    return {"enabled": S.raw(db, "semantic_search") == "1", "available": bool(cfg),
            "supported": supports_embeddings(S.raw(db, "provider")), "model": cfg and cfg["model"],
            "pending": embed.pending_count(db, cfg) if cfg else 0}


_indexing = threading.Lock()


@router.post("/semantic/index")
def semantic_index(ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    cfg = embed.semantic_cfg(db)
    if not cfg:
        raise HTTPException(409, "La búsqueda por significado no está activa o el proveedor no la ofrece.")
    if not _indexing.acquire(blocking=False):
        raise HTTPException(409, "Ya se está indexando.")

    def work():
        try:
            with models.session() as session:
                embed.index_pending(session, C.provider_for(models.session), cfg, budget=1800)
        finally:
            _indexing.release()

    threading.Thread(target=work, daemon=True).start()
    return {"ok": True}


# ---- Contactos ---------------------------------------------------------------------------------------------------

class ContactIn(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_-]+$")
    label: str = Field(default="", max_length=80)
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(default="", max_length=254)
    note: str = Field(default="", max_length=200)


def contact_view(c):
    return {"id": c.id, "code": c.code, "label": c.label, "name": c.name, "email": c.email, "note": c.note}


@router.get("/contacts")
def contacts(ctx=Depends(A.staff), db=Depends(A.get_db)):
    return [contact_view(c) for c in db.scalars(select(Contact).order_by(Contact.code))]


@router.put("/contacts")
def upsert_contact(data: ContactIn, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    c = db.scalar(select(Contact).where(Contact.code == data.code)) or Contact(code=data.code)
    c.label, c.name, c.email, c.note = data.label.strip(), data.name.strip(), data.email.strip(), data.note.strip()
    db.add(c)
    db.commit()
    return contact_view(c)


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "No existe ese contacto.")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ---- Tickets -----------------------------------------------------------------------------------------------------

@router.get("/tickets")
def tickets(ctx=Depends(A.staff), db=Depends(A.get_db)):
    rows = db.execute(select(Ticket, User.name, User.email).join(User, User.id == Ticket.user_id)
                      .order_by(Ticket.id.desc()).limit(200)).all()
    return [{"id": t.id, "name": t.name, "description": t.description, "state": t.state, "created_at": t.created_at,
             "requester": name, "email": email, "staff_notes": t.staff_notes} for t, name, email in rows]


class TicketPatch(BaseModel):
    state: str
    staff_notes: str | None = Field(default=None, max_length=6000)


@router.patch("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, data: TicketPatch, ctx=Depends(A.staff), db=Depends(A.get_db)):
    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "No existe ese ticket.")
    if data.state not in ("new", "progress", "done"):
        raise HTTPException(422, "Estado inválido.")
    t.state, t.assigned_to = data.state, ctx.user.id
    if data.staff_notes is not None:
        t.staff_notes = data.staff_notes.strip()
    if data.state == "done":
        t.resolved_at, t.resolved_by = now(), ctx.user.id
    else:
        t.resolved_at, t.resolved_by = None, None
    db.commit()
    return {"ok": True}


# ---- Estadísticas ------------------------------------------------------------------------------------------------

@router.get("/stats")
def stats(days: int = 30, ctx=Depends(A.staff), db=Depends(A.get_db)):
    days = max(1, min(days, 365))
    since = now() - timedelta(days=days)
    rows = db.execute(select(Insight.outcome, func.count(Insight.id), func.coalesce(func.avg(Insight.latency_ms), 0),
                             func.coalesce(func.sum(Insight.tokens_in), 0), func.coalesce(func.sum(Insight.tokens_out), 0))
                      .where(Insight.created_at >= since).group_by(Insight.outcome)).all()
    by_outcome = {r[0]: r[1] for r in rows}
    total = sum(by_outcome.values())
    per_day = db.execute(select(func.date(Insight.created_at), func.count(Insight.id)).where(Insight.created_at >= since)
                         .group_by(func.date(Insight.created_at)).order_by(func.date(Insight.created_at))).all()
    unanswered = db.execute(select(Insight.question, func.count(Insight.id)).where(
        Insight.created_at >= since, Insight.question.is_not(None), Insight.outcome.in_(("undocumented", "unsure")))
        .group_by(Insight.question).order_by(func.count(Insight.id).desc()).limit(20)).all()
    votes = dict(db.execute(select(Feedback.vote, func.count(Feedback.id)).group_by(Feedback.vote)).all())
    return {"days": days, "total": total, "by_outcome": by_outcome,
            "avg_latency_ms": int(sum(r[2] * r[1] for r in rows) / total) if total else 0,
            "tokens_in": int(sum(r[3] for r in rows)), "tokens_out": int(sum(r[4] for r in rows)),
            "per_day": [{"day": str(d), "count": n} for d, n in per_day],
            "unanswered": [{"question": q, "count": n} for q, n in unanswered],
            "feedback": {"up": votes.get(1, 0), "down": votes.get(-1, 0)},
            "tickets_open": db.scalar(select(func.count(Ticket.id)).where(Ticket.state != "done"))}


@router.get("/feedback")
def feedback_list(ctx=Depends(A.staff), db=Depends(A.get_db)):
    rows = db.scalars(select(Feedback).where(Feedback.vote == -1).order_by(Feedback.id.desc()).limit(100))
    return [{"day": f.day, "reason": f.reason, "model": f.model, "question": f.question} for f in rows]


@router.delete("/conversations")
def delete_all_conversations(request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    count = db.scalar(select(func.count(Message.id)))
    db.query(Message).delete()
    db.execute(User.__table__.update().values(chat_generation=User.chat_generation + 1))
    A.audit(db, ctx.user, "conversations_deleted", f"{count} mensajes", request)
    db.commit()
    return {"deleted": count}
