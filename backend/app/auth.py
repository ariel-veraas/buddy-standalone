"""Sesiones, CSRF, roles y límite de intentos de login."""
import re
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select

from . import config, models, security
from .models import AuditLog, Session as DbSession, User, now

COOKIE = "buddy_session"
ROLES = ("admin", "editor", "user")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")


def get_db():
    s = models.session()
    try:
        yield s
    finally:
        s.close()


def audit(db, actor, action, detail="", request=None):
    db.add(AuditLog(actor_id=getattr(actor, "id", None), actor_email=getattr(actor, "email", "") or "", action=action,
                    detail=detail[:400], ip=client_ip(request) if request else ""))


def client_ip(request):
    return request.client.host if request and request.client else ""


class RateLimiter:
    """Ventana deslizante en memoria (por proceso). Suficiente para un servidor chico; el bloqueo por usuario va en la base."""

    def __init__(self, limit, seconds):
        self.limit, self.seconds, self.hits, self.lock = limit, seconds, defaultdict(deque), threading.Lock()

    def check(self, key):
        stamp = time.monotonic()
        with self.lock:
            queue = self.hits[key]
            while queue and stamp - queue[0] > self.seconds:
                queue.popleft()
            if len(queue) >= self.limit:
                return False
            queue.append(stamp)
            if len(self.hits) > 20000:  # no crecer sin límite ante un ataque con muchas claves
                self.hits.clear()
            return True

    def reset(self):
        with self.lock:
            self.hits.clear()


login_limiter = RateLimiter(20, 300)  # por IP
login_account_limiter = RateLimiter(8, 600)  # por (email, IP): frena la fuerza bruta sin dejar a nadie afuera de su cuenta
password_limiter = RateLimiter(5, 600)  # intentos de cambio de contraseña por usuario


def cookie_secure(request: Request) -> bool:
    if config.COOKIE_SECURE in ("1", "0"):
        return config.COOKIE_SECURE == "1"
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def start_session(db, user, request: Request, response: Response):
    token, csrf = security.new_token(), security.new_token()
    db.add(DbSession(token_hash=security.token_hash(token), csrf=csrf, user_id=user.id, auth_version=user.auth_version,
                     expires_at=now() + timedelta(hours=config.SESSION_HOURS)))
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=cookie_secure(request),
                        max_age=config.SESSION_HOURS * 3600, path="/")
    return csrf


class Ctx:
    """Quién pregunta: usuario + sesión (para el CSRF)."""

    def __init__(self, user, session):
        self.user, self.session = user, session


def current(request: Request, db=Depends(get_db)) -> Ctx:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "No iniciaste sesión.")
    row = db.scalar(select(DbSession).where(DbSession.token_hash == security.token_hash(token)))
    if not row or row.expires_at <= now():
        raise HTTPException(401, "La sesión venció. Volvé a entrar.")
    user = db.get(User, row.user_id)
    if not user or not user.active or user.auth_version != row.auth_version:
        raise HTTPException(401, "La sesión ya no es válida. Volvé a entrar.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sent = request.headers.get("x-csrf-token", "")
        if not sent or not security.hmac.compare_digest(sent, row.csrf):
            raise HTTPException(403, "Falta el token de seguridad (CSRF). Recargá la página.")
        origin = request.headers.get("origin")
        if origin and origin.split("://", 1)[-1] != request.headers.get("host", ""):
            raise HTTPException(403, "Origen no permitido.")
    return Ctx(user, row)


def user_ctx(ctx: Ctx = Depends(current)) -> Ctx:
    if ctx.user.must_change_password and not getattr(ctx, "allow_pending", False):
        raise HTTPException(403, "Tenés que cambiar la contraseña antes de seguir.")
    return ctx


def require(*roles):
    def dependency(ctx: Ctx = Depends(user_ctx)) -> Ctx:
        if ctx.user.role not in roles:
            raise HTTPException(403, "No tenés permiso para hacer esto.")
        return ctx
    return dependency


admin_only = require("admin")
staff = require("admin", "editor")
