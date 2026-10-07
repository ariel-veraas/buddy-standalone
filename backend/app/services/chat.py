"""Motor del chat: cupos, un pedido a la vez por persona, memoria de la conversación, streaming y feedback anónimo.

Port del motor de Buddy v2. Los pedidos web preparan el plan (`prepare`, rápido y con errores claros) y el streaming
lo consume (`stream_events`) usando sesiones de base propias: la del pedido ya está cerrada cuando el stream corre.
"""
import hashlib
import logging
import re
import secrets
import time
import uuid
from datetime import date, timedelta

from sqlalchemy import delete, func, select, text as sql

from .. import models
from ..core import prompts, stream as stream_mod
from ..core.privacy import REASON_CODES
from ..core.provider import BuddyProvider, ProviderError
from ..core.text import CONTEXT_QUESTION_CHARS, MAX_CONTEXT_QUESTIONS, is_greeting, is_placeholder_email, strip_control_chars, strip_greeting
from ..models import Contact, Feedback, Insight, Message, Ticket, Usage, User, now
from . import search, settings as S

log = logging.getLogger("buddy.chat")
MAX_MESSAGE_CHARS = 2000
HISTORY_LIMIT = 30
HISTORY_CHARS = 6000
LEASE_SECONDS = 45
INSIGHT_QUESTION_CHARS = 500
LOCK_NS = 1112884313
FEEDBACK_TOKEN = re.compile(r"[A-Za-z0-9_-]{16,64}")
FEEDBACK_PER_MINUTE = 10
FEEDBACK_MAX_CHANGES = 6
_DRIVE_LINK = re.compile(r"https://(?:docs|drive)\.google\.com/[^\x00-\x20\x7f\\]*")


class Busy(Exception):
    """Un motivo por el que la consulta no corrió o falló. `code` es estable y lo traduce el frontend."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def safe_link(url):
    return url if isinstance(url, str) and len(url) <= 2000 and _DRIVE_LINK.fullmatch(url) else ""


def provider_for(db_factory):
    return BuddyProvider(S.provider_loader(db_factory))


# ---- Conversación -----------------------------------------------------------------------------------------------

def current_generation(db, user):
    """Número de la conversación actual. Si cambiaron los permisos de la persona, la anterior se descarta."""
    if user.chat_perm_version != user.perm_version:
        db.execute(delete(Message).where(Message.user_id == user.id))
        user.chat_generation += 1
        user.chat_perm_version = user.perm_version
        db.flush()
    return user.chat_generation


def forget(db, user):
    db.execute(delete(Message).where(Message.user_id == user.id))
    user.chat_generation += 1
    db.execute(sql("UPDATE usage SET state = 'failed', error_code = 'session_changed' WHERE user_id = :u AND state = 'reserved'"),
               {"u": user.id})
    db.flush()
    return user.chat_generation


def history(db, user, limit=HISTORY_LIMIT):
    generation = current_generation(db, user)
    rows = list(db.scalars(select(Message).where(Message.user_id == user.id, Message.generation == generation)
                           .order_by(Message.id.desc()).limit(max(1, min(int(limit), HISTORY_LIMIT)))))
    tickets = {}
    keys = [r.request_id for r in rows if r.role == "assistant" and r.request_id]
    if keys:
        tickets = {t.request_key: {"id": t.id, "name": t.name} for t in db.scalars(
            select(Ticket).where(Ticket.user_id == user.id, Ticket.request_key.in_(keys)))}
    return {"messages": [public_message(r, tickets) for r in reversed(rows)], "session_generation": generation}


def public_message(row, tickets=None):
    """Un mensaje guardado tal como lo necesita el frontend. Se revalida al salir: lo guardado no es de fiar a ciegas."""
    created = row.created_at.isoformat() if row.created_at else ""
    if row.role == "user":
        return {"role": "user", "text": row.content, "date": created}
    data = row.response_json if isinstance(row.response_json, dict) else {}

    def text(value, limit):
        return value[:limit] if isinstance(value, str) else ""

    sources = []
    for src in data.get("sources") if isinstance(data.get("sources"), list) else []:
        if isinstance(src, dict):
            sources.append({"title": text(src.get("title"), 300), "owner": text(src.get("owner"), 300),
                            "updated": text(src.get("updated"), 10), "link": safe_link(text(src.get("link"), 2000))})
    ticket = data.get("ticket")
    ticket = ({"title": text(ticket.get("title"), 120), "description": text(ticket.get("description"), 2000)}
              if isinstance(ticket, dict) and text(ticket.get("title"), 120) else None)
    contact = data.get("contact")
    contact = {k: text(contact.get(k), 200) for k in ("role", "label", "name", "contact")} if isinstance(contact, dict) else None
    token = row.feedback_token if isinstance(row.feedback_token, str) and FEEDBACK_TOKEN.fullmatch(row.feedback_token) else None
    return {"role": "assistant", "text": row.content, "date": created,
            "expression": data.get("expression") if data.get("expression") in prompts.EXPRESSIONS else "neutral",
            "ring": "doubt" if data.get("ring") == "doubt" else "ok", "sources": sources, "ticket": ticket, "contact": contact,
            "confidence": data.get("confidence") if data.get("confidence") in prompts.CONFIDENCE_LEVELS else None,
            "conflict": data.get("conflict") is True,
            "feedback_token": token, "feedback": row.feedback_vote if token and row.feedback_vote else None,
            "ticket_key": row.request_id if ticket and row.request_id else None,
            "ticket_created": (tickets or {}).get(row.request_id) if ticket else None}


def _conversation_context(db, user, generation):
    rows = list(db.scalars(select(Message).where(Message.user_id == user.id, Message.generation == generation)
                           .order_by(Message.id.desc()).limit(2 * MAX_CONTEXT_QUESTIONS)))
    questions, titles, last_answer = [], [], True
    for row in rows:
        if row.role == "assistant" and last_answer:
            sources = (row.response_json or {}).get("sources") if isinstance(row.response_json, dict) else None
            titles = ([s["title"] for s in sources[:3] if isinstance(s, dict) and isinstance(s.get("title"), str)]
                      if isinstance(sources, list) else [])
        elif row.role == "user" and len(questions) < MAX_CONTEXT_QUESTIONS:
            questions.append((row.content or "")[:CONTEXT_QUESTION_CHARS])
        last_answer = False
    return {"questions": questions, "titles": titles} if questions else None


def _history_for_model(db, user, generation, turns=6):
    rows = db.scalars(select(Message).where(Message.user_id == user.id, Message.generation == generation)
                      .order_by(Message.id.desc()).limit(turns * 2))
    out, size = [], 0
    for row in rows:
        if size + len(row.content) > HISTORY_CHARS:
            break
        out.append({"role": row.role, "content": row.content})
        size += len(row.content)
    return list(reversed(out))


# ---- Cupos y reserva --------------------------------------------------------------------------------------------

def reserve_quota(db, user, cfg, current=None):
    """Cupos compartidos por chat y tareas: misma capacidad y libro de uso."""
    current = current or now()
    db.execute(sql("SELECT pg_advisory_xact_lock(:ns, 0)"), {"ns": LOCK_NS})
    if cfg["max_concurrent"]:
        db.execute(sql("SELECT pg_advisory_xact_lock(:ns, 0)"), {"ns": LOCK_NS})
        running = db.scalar(select(func.count(Usage.id)).where(Usage.state == "reserved", Usage.lease_until > current))
        if running >= cfg["max_concurrent"]:
            raise Busy("busy")  # no se reservó nada: este intento no gasta cupo
    for key, interval, code in (("rate_day", timedelta(days=1), "daily_limit"), ("rate_min", timedelta(minutes=1), "rate_limited")):
        if cfg[key] and db.scalar(select(func.count(Usage.id)).where(Usage.user_id == user.id, Usage.created_at >= current - interval)) >= cfg[key]:
            raise Busy(code)
    if cfg["max_total"] and db.scalar(select(func.count(Usage.id)).where(Usage.created_at >= current - timedelta(days=1))) >= cfg["max_total"]:
        raise Busy("system_limit")


def _start_request(db, user, message, cfg, expected_generation, request_id):
    db.execute(sql("SELECT pg_advisory_xact_lock(:ns, :u)"), {"ns": LOCK_NS, "u": user.id})  # un pedido a la vez por persona
    generation = current_generation(db, user)
    if expected_generation is not None and generation != expected_generation:
        raise Busy("session_changed")
    previous = db.scalar(select(Usage).where(Usage.user_id == user.id, Usage.request_id == request_id))
    if previous:
        if previous.generation != generation:
            raise Busy("session_changed")
        cached = db.scalar(select(Message).where(Message.user_id == user.id, Message.request_id == request_id,
                                                 Message.generation == generation, Message.role == "assistant"))
        if previous.state == "done" and cached is not None and cached.response_json:
            return {"cached": dict(cached.response_json)}
        raise Busy(previous.error_code or "request_pending")
    current = now()
    live = db.scalar(select(Usage).where(Usage.user_id == user.id, Usage.state == "reserved", Usage.lease_until > current))
    if live:
        raise Busy("busy")
    db.execute(sql("UPDATE usage SET state = 'failed', error_code = 'session_changed' WHERE user_id = :u AND state = 'reserved' "
                   "AND lease_until <= :n"), {"u": user.id, "n": current})
    reserve_quota(db, user, cfg, current)
    usage = Usage(user_id=user.id, request_id=request_id, generation=generation, lease_until=current + timedelta(seconds=LEASE_SECONDS))
    db.add(usage)
    db.flush()
    is_new = (db.scalar(select(func.count(Message.id)).where(Message.user_id == user.id, Message.role == "user")) or 0) < cfg["new_turns"]
    plan = {"usage_id": usage.id, "generation": generation, "request_id": request_id, "is_new": is_new,
            "history": _history_for_model(db, user, generation), "context": _conversation_context(db, user, generation)}
    db.add(Message(user_id=user.id, role="user", content=message, generation=generation, request_id=request_id))
    return plan


def _close(db_factory, token, response=None, error=None, insight=None):
    """Cierra la reserva: guarda la respuesta (si todavía es la vigente) o la libera. Nunca deja una reserva colgada."""
    with db_factory() as db:
        user = db.get(User, token["user_id"])
        usage = db.get(Usage, token["usage_id"])
        valid = bool(user and usage and usage.state == "reserved" and user.chat_generation == token["generation"]
                     and user.chat_perm_version == user.perm_version == token["perm_version"])
        if response is not None and valid:
            meta = insight or {}
            values = {"user_id": user.id, "role": "assistant", "content": response["answer"], "generation": token["generation"],
                      "request_id": token["request_id"], "response_json": response}
            fb = response.get("feedback_token")
            if isinstance(fb, str) and FEEDBACK_TOKEN.fullmatch(fb):
                values["feedback_token"] = fb
                values["feedback_context"] = {"docs": [int(i) for i in meta.get("document_ids") or []], "model": str(meta.get("model") or "")[:200]}
            db.add(Message(**values))
            usage.state = "done"
        elif usage and usage.state == "reserved":
            usage.state = "failed"
            usage.error_code = error or "session_changed"
            db.execute(delete(Message).where(Message.user_id == token["user_id"], Message.request_id == token["request_id"]))
        if usage:
            usage.lease_until = None
        if insight is not None:
            _store_insight(db, token["user_id"], insight)
        db.commit()
    return valid


def _store_insight(db, user_id, data):
    """Una fila de estadística por consulta. Nunca falla: no puede convertir una buena respuesta en un error.

    El texto de la pregunta se guarda solo cuando Buddy no pudo responder (así se sabe qué documentar) o si el administrador
    activó «Guardar preguntas»; nunca con el nombre de quien preguntó."""
    try:
        keep = data.get("store_question") or data.get("needs_human") or data.get("confidence") == "low" or data.get("retrieved_count") == 0
        outcome = "error" if data.get("error") else "undocumented" if data.get("needs_human") else \
            "unsure" if data.get("confidence") == "low" or data.get("conflict") else "answered"
        db.add(Insight(user_id=None, model=data.get("model") or "", question=data["question"] if keep else None, outcome=outcome,
                       error=data.get("error") or None, chunks=data.get("retrieved_count") or 0, tokens_in=data.get("tokens_in") or 0,
                       tokens_out=data.get("tokens_out") or 0, latency_ms=data.get("latency_ms") or 0))
    except Exception as exc:  # noqa: BLE001
        log.warning("No pude guardar la estadística (%s)", type(exc).__name__)


def _insight_data(message, model, chunks, started, usage, result=None, error=None, semantic=None, store_question=False):
    chunks = chunks or []
    retrieved = [c for c in chunks if not c.get("neighbor")]
    used = [] if not result or result.get("needs_human") else _used_chunks(chunks, result.get("sources_used"))
    documents = {}
    for c in used:
        if c.get("doc_id"):
            documents.setdefault(c["doc_id"], True)
    return {"question": message[:INSIGHT_QUESTION_CHARS], "needs_human": bool(result and result.get("needs_human")),
            "retrieved_count": len(retrieved), "document_ids": list(documents), "model": model,
            "tokens_in": (usage or {}).get("in") or 0, "tokens_out": (usage or {}).get("out") or 0,
            "latency_ms": max(0, int((time.monotonic() - started) * 1000)), "error": error or False,
            "confidence": (result or {}).get("confidence") or False, "conflict": bool((result or {}).get("conflict")),
            "store_question": store_question}


# ---- Armado de la respuesta -------------------------------------------------------------------------------------

def _used_chunks(chunks, used):
    if used is None:
        return list(chunks)
    picked = [chunks[n - 1] for n in sorted(set(used)) if 1 <= n <= len(chunks)]
    if used and not picked:
        return list(chunks)
    return picked


def _dedupe_sources(chunks):
    seen, out = set(), []
    for c in chunks:
        if c["doc_id"] not in seen:
            seen.add(c["doc_id"])
            out.append({"title": c["title"], "owner": c["owner"], "updated": c["updated"], "link": safe_link(c.get("link"))})
    return out


def _is_unsure(result):
    return bool(result.get("conflict")) or result.get("confidence") == "low"


def _contact_for(db, role):
    code = (role or "general").strip().lower()
    contact = db.scalar(select(Contact).where(Contact.code == code)) or db.scalar(select(Contact).where(Contact.code == "general"))
    if not contact:
        return None
    email = "" if is_placeholder_email(contact.email) else contact.email
    return {"role": contact.code, "label": contact.label, "name": contact.name, "contact": email}


def _compose_response(result, message, chunks, generation, contact):
    human = result["needs_human"]
    unsure = _is_unsure(result)
    ticket = result["ticket"] or {"title": "Consulta: " + message[:70], "description": message}
    sources = [] if human else _dedupe_sources(_used_chunks(chunks, result.get("sources_used")))
    return {"answer": result["answer"], "expression": result["expression"], "ring": "doubt" if human or unsure else "ok",
            "sources": sources, "ticket": ticket if human else None, "contact": contact if human or unsure else None,
            "confidence": result.get("confidence"), "conflict": bool(result.get("conflict")),
            "feedback_token": secrets.token_urlsafe(18) if human or sources else None,
            "error": None, "session_generation": generation}


def _normalize(raw, message):
    try:
        result = prompts.validate_model_output(raw)
    except (ValueError, TypeError) as exc:
        raise Busy("invalid_response") from exc
    if not is_greeting(message):
        result["answer"] = strip_greeting(result["answer"])
    return result


def _failure_code(exc):
    if isinstance(exc, Busy):
        return exc.code
    if isinstance(exc, (ValueError, TypeError)):
        return "invalid_response"
    if isinstance(exc, TimeoutError):
        return "provider_timeout"
    log.warning("Proveedor falló (%s)", getattr(exc, "code", type(exc).__name__))
    return "provider_auth" if isinstance(exc, ProviderError) and exc.code == "invalid_key" else "provider_error"


# ---- Entrada: preparar y transmitir -----------------------------------------------------------------------------

def prepare(user_id, message, expected_generation=None, request_id=None, db_factory=None):
    """Valida, reserva el cupo, busca los fragmentos y arma el prompt. Devuelve el plan para `stream_events`."""
    db_factory = db_factory or models.session
    if isinstance(message, str):
        message = strip_control_chars(message)
    if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
        raise Busy("invalid_message")
    message = message.strip()
    if expected_generation is not None and (type(expected_generation) is not int or expected_generation < 1):
        raise Busy("session_changed")
    try:
        request_id = str(uuid.UUID(request_id)) if request_id else str(uuid.uuid4())
    except (TypeError, ValueError, AttributeError) as exc:
        raise Busy("invalid_message") from exc
    with db_factory() as db:
        user = db.get(User, user_id)
        if not user or not user.active:
            raise Busy("session_changed")
        cfg = S.engine_cfg(db)
        if not cfg["chat_model"]:
            raise Busy("not_configured")
        cfg["deadline"] = time.monotonic() + cfg["timeout"]
        try:
            token = _start_request(db, user, message, cfg, expected_generation, request_id)
            if "cached" in token:
                db.commit()
                return {"cached": token["cached"]}
            token.update(user_id=user.id, perm_version=user.perm_version)
            db.commit()
        except Busy:
            db.commit()  # una generación nueva (permisos cambiados) se guarda aunque la consulta se rechace
            raise
    started, chunks, semantic = time.monotonic(), [], {}
    try:
        with db_factory() as db:
            user = db.get(User, user_id)
            provider = provider_for(db_factory)
            chunks = search.retrieve(db, user, message, cfg, provider, token.get("context"), semantic)
            catalog = search.catalog(db, user)
            roles = [c.code for c in db.scalars(select(Contact))]
            profile = {"name": user.name, "is_new": token["is_new"], "stage": ""}
        messages = [{"role": "system", "content": prompts.build_system_prompt(
            cfg["buddy_name"], cfg["company"], roles, cfg["extra_instructions"], cfg["dialect"])}]
        messages += token["history"] + [{"role": "user", "content": prompts.build_user_prompt(message, profile, chunks, catalog)}]
    except Exception as exc:  # noqa: BLE001
        code = exc.code if isinstance(exc, Busy) else "provider_error"
        if not isinstance(exc, Busy):
            log.warning("Consulta fallida (%s)", type(exc).__name__)
        _close(db_factory, token, error=code, insight=_insight_data(message, cfg["chat_model"], chunks, started, {}, None, code, semantic, cfg["store_questions"]))
        raise Busy(code) from exc
    return {"token": token, "model": cfg["chat_model"], "messages": messages, "chunks": chunks, "message": message,
            "deadline": cfg["deadline"], "timeout": cfg["timeout"], "started": started, "semantic": semantic,
            "store_questions": cfg["store_questions"], "db_factory": db_factory}


def stream_events(plan):
    """Genera (evento, datos): ("delta", {text}), ("done", respuesta) o ("error", {error}). Cerrar el generador antes de
    tiempo (el navegador se fue) libera la reserva y no guarda nada."""
    if "cached" in plan:
        yield "done", plan["cached"]
        return
    token, factory = plan["token"], plan["db_factory"]
    extractor, parts, size, persisted, source = stream_mod.AnswerExtractor(), [], 0, False, None
    started, usage, result, sent = plan["started"], {}, None, False

    def failure(code):
        if sent:
            return None
        return _insight_data(plan["message"], plan["model"], plan["chunks"], started, usage, result, code, plan["semantic"], plan["store_questions"])

    gate = stream_mod.GreetingGate(strip=not is_greeting(plan["message"]))
    try:
        remaining = plan["deadline"] - time.monotonic()
        if remaining <= 0:
            raise Busy("provider_timeout")
        source = provider_for(factory)._chat_stream(plan["model"], plan["messages"], min(plan["timeout"], remaining), usage=usage)
        for fragment in source:
            size += len(fragment)
            if size > stream_mod.MAX_STREAM_CHARS:
                raise ValueError("Respuesta demasiado larga.")
            parts.append(fragment)
            text = gate.feed(extractor.feed(fragment))
            if text:
                yield "delta", {"text": text}
        text = gate.finish()
        if text:
            yield "delta", {"text": text}
        result = _normalize(prompts.parse_model_json("".join(parts)), plan["message"])
        contact = None
        if result["needs_human"] or _is_unsure(result):
            with factory() as db:
                contact = _contact_for(db, result["contact_role"])
        response = _compose_response(result, plan["message"], plan["chunks"], token["generation"], contact)
        if plan["deadline"] - time.monotonic() <= 0:
            raise Busy("provider_timeout")
        insight = _insight_data(plan["message"], plan["model"], plan["chunks"], started, usage, result, None, plan["semantic"], plan["store_questions"])
        sent = True
        if not _close(factory, token, response=response, insight=insight):
            raise Busy("session_changed")
        persisted = True
        yield "done", response
    except GeneratorExit:
        if not persisted:
            _safe_close(factory, token, "client_disconnected", failure("client_disconnected"))
        raise
    except Exception as exc:  # noqa: BLE001
        code = _failure_code(exc)
        if not persisted:
            _safe_close(factory, token, code, failure(code))
        yield "error", {"error": code}
    finally:
        if source is not None:
            source.close()


def release_unstarted(plan):
    """El navegador se fue antes de leer el primer byte: se libera la reserva."""
    token = plan.get("token") if isinstance(plan, dict) else None
    if token:
        _safe_close(plan["db_factory"], token, "client_disconnected", _insight_data(
            plan["message"], plan["model"], plan["chunks"], plan["started"], {}, None, "client_disconnected", plan["semantic"], plan["store_questions"]))


def _safe_close(factory, token, code, insight):
    try:
        _close(factory, token, error=code, insight=insight)
    except Exception as exc:  # noqa: BLE001
        log.warning("No pude liberar la consulta (%s)", type(exc).__name__)


# ---- Feedback anónimo y tickets ---------------------------------------------------------------------------------

def vote(db, user, token, value, reason=None, include_question=False):
    """Registra (o cambia, o retira) el 👍/👎 de una respuesta propia. Devuelve {"vote": "up"|"down"|None}."""
    if (not isinstance(token, str) or not FEEDBACK_TOKEN.fullmatch(token) or value not in ("up", "down", "none")
            or (reason is not None and reason not in REASON_CODES) or type(include_question) is not bool):
        raise Busy("invalid_request")
    db.execute(sql("SELECT pg_advisory_xact_lock(:ns, :u)"), {"ns": LOCK_NS, "u": user.id})
    generation = current_generation(db, user)
    row = db.scalar(select(Message).where(Message.user_id == user.id, Message.generation == generation,
                                          Message.role == "assistant", Message.feedback_token == token))
    if not row:
        raise Busy("feedback_unknown")
    current = now()
    recent = db.scalar(select(func.count(Message.id)).where(Message.user_id == user.id, Message.feedback_at >= current - timedelta(seconds=60),
                                                            Message.id != row.id))
    if recent >= FEEDBACK_PER_MINUTE or row.feedback_changes >= FEEDBACK_MAX_CHANGES:
        raise Busy("rate_limited")
    row.feedback_changes += 1
    row.feedback_at = current
    if row.feedback_id:
        old = db.get(Feedback, row.feedback_id)
        if old:
            db.delete(old)
        row.feedback_id = None
    if value == "none":
        row.feedback_vote = None
        return {"vote": None}
    context = row.feedback_context if isinstance(row.feedback_context, dict) else {}
    keep = value == "down" and (include_question or S.raw(db, "store_questions") == "1")
    question = ""
    if keep and row.request_id:
        asked = db.scalar(select(Message).where(Message.user_id == user.id, Message.request_id == row.request_id, Message.role == "user"))
        question = asked.content if asked else ""
    # El voto no tiene usuario ni hora (solo el día) y no guarda el token: nadie puede volver de la fila a la persona.
    code = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
    record = Feedback(day=date.today().isoformat(), code_hash=code, vote=1 if value == "up" else -1, reason=reason,
                      document_ids=context.get("docs") or [], model=context.get("model"), question=question or None)
    db.add(record)
    db.flush()
    row.feedback_vote, row.feedback_id = value, record.id
    return {"vote": value}


def create_ticket(db, user, title, description, request_key, generation=None):
    if generation is not None and current_generation(db, user) != generation:
        raise Busy("session_changed")
    title = strip_control_chars(str(title or "")).strip()[:120]
    if not title:
        raise Busy("invalid_request")
    if request_key:
        found = db.scalar(select(Ticket).where(Ticket.user_id == user.id, Ticket.request_key == request_key))
        if found:
            return {"id": found.id, "name": found.name}
    if db.scalar(select(func.count(Ticket.id)).where(Ticket.user_id == user.id, Ticket.created_at >= now() - timedelta(hours=1))) >= 20:
        raise Busy("rate_limited")
    original = db.scalar(select(Message.content).where(Message.user_id == user.id, Message.request_id == request_key,
                         Message.role == "user")) if request_key else None
    ticket = Ticket(user_id=user.id, name=title, description=strip_control_chars(str(description or ""))[:2000],
                    question=original or (description if not request_key else ""), request_key=request_key)
    db.add(ticket)
    db.flush()
    return {"id": ticket.id, "name": ticket.name}
