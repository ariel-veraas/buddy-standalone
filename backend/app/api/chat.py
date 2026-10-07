import json
import re

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .. import auth as A, models
from ..models import User
from ..services import chat as C, settings as S

router = APIRouter(prefix="/api/chat")

STATUS = {"rate_limited": 429, "daily_limit": 429, "system_limit": 429, "busy": 429, "request_pending": 409,
          "session_changed": 409, "invalid_message": 400, "invalid_request": 400, "feedback_unknown": 404,
          "not_configured": 503, "provider_auth": 502, "provider_error": 502, "provider_timeout": 504,
          "invalid_response": 502}


def fail(code, **extra):
    return JSONResponse({"error": code, **extra}, status_code=STATUS.get(code, 400))


class AskIn(BaseModel):
    message: str = Field(max_length=4000)
    session_generation: int | None = None
    request_id: str | None = Field(default=None, max_length=64)


class VoteIn(BaseModel):
    token: str = Field(max_length=80)
    vote: str = Field(max_length=8)
    reason: str | None = Field(default=None, max_length=40)
    include_question: bool = False


class TicketIn(BaseModel):
    title: str = Field(max_length=200)
    description: str = Field(default="", max_length=4000)
    request_key: str | None = Field(default=None, max_length=64)
    session_generation: int | None = None


@router.get("/config")
def config(ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    cfg = S.engine_cfg(db)
    user = db.get(User, ctx.user.id)
    generation = C.current_generation(db, user)
    db.commit()
    return {"configured": bool(cfg["chat_model"]), "buddy_name": cfg["buddy_name"], "company": cfg["company"],
            "session_generation": generation, "species": cfg["species"], "color": cfg["color"],
            "default_wallpaper": cfg["wallpaper"], "prefs": _prefs(user)}


DEFAULT_PREFS = {"wallpaper": "", "tint": "azul", "accessory": "", "asked": 0, "streak": 0, "last_day": "",
                 "gba": False, "sound": False}


def _prefs(user):
    try:
        stored = json.loads(user.prefs or "{}")
    except ValueError:
        stored = {}
    return {**DEFAULT_PREFS, **{k: v for k, v in stored.items() if k in DEFAULT_PREFS}}


class PrefsIn(BaseModel):
    wallpaper: str | None = Field(default=None, max_length=20)
    tint: str | None = Field(default=None, max_length=20)
    accessory: str | None = Field(default=None, max_length=20)
    asked: int | None = Field(default=None, ge=0, le=1_000_000)
    streak: int | None = Field(default=None, ge=0, le=100_000)
    last_day: str | None = Field(default=None, max_length=10)
    gba: bool | None = Field(default=None, strict=True)
    sound: bool | None = Field(default=None, strict=True)


@router.put("/prefs")
def put_prefs(data: PrefsIn, ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    """Preferencias cosméticas de la persona (fondo, tinte, accesorio, cariño, racha). Nada de esto afecta permisos."""
    user = db.get(User, ctx.user.id)
    prefs, new = _prefs(user), data.model_dump(exclude_none=True)
    checks = {"wallpaper": ("",) + S.WALLPAPERS, "tint": S.TINTS, "accessory": S.ACCESSORIES}
    for key, allowed in checks.items():
        if key in new and new[key] not in allowed:
            return fail("invalid_request")
    if "last_day" in new and new["last_day"] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", new["last_day"]):
        return fail("invalid_request")
    if "asked" in new:  # el cariño solo sube
        new["asked"] = max(new["asked"], prefs["asked"])
    prefs.update(new)
    user.prefs = json.dumps(prefs)
    db.commit()
    return {"prefs": prefs}


@router.get("/suggestions")
def suggestions(ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    """Preguntas sugeridas a partir de los documentos que ESTA persona puede leer (nunca de los restringidos)."""
    from ..services import search
    titles = search.catalog(db, db.get(User, ctx.user.id))["titles"][:4]
    return {"suggestions": [f"¿Qué dice «{t}»?" for t in titles if t]}


@router.get("/history")
def history(ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    data = C.history(db, db.get(User, ctx.user.id))
    db.commit()
    return data


@router.post("/stream")
def stream(data: AskIn, ctx=Depends(A.user_ctx)):
    try:
        plan = C.prepare(ctx.user.id, data.message, data.session_generation, data.request_id)
    except C.Busy as exc:
        return fail(exc.code)

    def events():
        started = False
        try:
            for kind, payload in C.stream_events(plan):
                started = True
                yield f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        finally:
            if not started:
                C.release_unstarted(plan)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/forget")
def forget(ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    generation = C.forget(db, db.get(User, ctx.user.id))
    db.commit()
    return {"session_generation": generation}


@router.post("/feedback")
def feedback(data: VoteIn, ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    try:
        out = C.vote(db, db.get(User, ctx.user.id), data.token, data.vote, data.reason, data.include_question)
        db.commit()
        return out
    except C.Busy as exc:
        db.rollback()
        return fail(exc.code)


@router.post("/ticket")
def ticket(data: TicketIn, ctx=Depends(A.user_ctx), db=Depends(A.get_db)):
    try:
        out = C.create_ticket(db, db.get(User, ctx.user.id), data.title, data.description, data.request_key, data.session_generation)
        db.commit()
        return out
    except C.Busy as exc:
        db.rollback()
        return fail(exc.code)
