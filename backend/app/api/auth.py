from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import auth as A, config, security
from ..services import settings
from ..models import Session as DbSession, User, now

router = APIRouter(prefix="/api")


def public_user(user):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role,
            "must_change_password": user.must_change_password}


class SetupIn(BaseModel):
    setup_token: str | None = Field(default=None, max_length=200)
    email: str = Field(max_length=254)
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(max_length=200)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class PasswordIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(max_length=200)


@router.get("/setup/status")
def setup_status(db=Depends(A.get_db)):
    cfg = settings.engine_cfg(db)  # la cara pública: nombre y personaje (nada sensible)
    return {"needs_setup": db.scalar(select(func.count(User.id))) == 0, "needs_token": bool(config.SETUP_TOKEN),
            "brand": {"name": cfg["buddy_name"], "species": cfg["species"], "color": cfg["color"]}}


@router.post("/setup")
def setup(data: SetupIn, request: Request, response: Response, db=Depends(A.get_db)):
    """Primer arranque: crea el administrador. Solo funciona mientras no exista ningún usuario."""
    db.execute(select(func.pg_advisory_xact_lock(7001)))  # dos pedidos a la vez no crean dos administradores
    if db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(409, "Buddy ya está configurado.")
    if config.SETUP_TOKEN and not security.hmac.compare_digest(data.setup_token or "", config.SETUP_TOKEN):
        raise HTTPException(403, "El código de instalación no es correcto.")
    email = data.email.strip().lower()
    if not A.EMAIL.match(email):
        raise HTTPException(422, "El email no es válido.")
    problem = security.password_problem(data.password)
    if problem:
        raise HTTPException(422, problem)
    user = User(email=email, name=data.name.strip(), password_hash=security.hash_password(data.password), role="admin")
    db.add(user)
    db.flush()
    A.audit(db, user, "setup", "Administrador inicial creado", request)
    csrf = A.start_session(db, user, request, response)
    db.commit()
    return {"user": public_user(user), "csrf": csrf}


@router.post("/auth/login")
def login(data: LoginIn, request: Request, response: Response, db=Depends(A.get_db)):
    if not A.login_limiter.check(A.client_ip(request)):
        raise HTTPException(429, "Demasiados intentos. Esperá unos minutos.")
    email = data.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not A.login_account_limiter.check(f"{email}|{A.client_ip(request)}"):
        raise HTTPException(429, "Demasiados intentos con esa cuenta. Esperá unos minutos.")
    ok = security.verify_password(user.password_hash if user else None, data.password)
    if not ok or not user or not user.active:
        if user and user.active:
            A.audit(db, user, "login_failed", "", request)
            db.commit()
        # El mismo mensaje para email inexistente, clave mala o usuario desactivado.
        raise HTTPException(401, "Email o contraseña incorrectos.")
    user.last_login = now()
    if security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(data.password)
    csrf = A.start_session(db, user, request, response)
    A.audit(db, user, "login", "", request)
    db.commit()
    return {"user": public_user(user), "csrf": csrf}


@router.post("/auth/logout")
def logout(request: Request, response: Response, ctx=Depends(A.current), db=Depends(A.get_db)):
    row = db.get(DbSession, ctx.session.id)
    if row:
        db.delete(row)
    A.audit(db, ctx.user, "logout", "", request)
    db.commit()
    response.delete_cookie(A.COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(ctx=Depends(A.current)):
    return {"user": public_user(ctx.user), "csrf": ctx.session.csrf}


@router.post("/auth/password")
def change_password(data: PasswordIn, request: Request, response: Response, ctx=Depends(A.current), db=Depends(A.get_db)):
    user = db.get(User, ctx.user.id)
    if not A.password_limiter.check(str(user.id)):
        raise HTTPException(429, "Demasiados intentos. Esperá unos minutos.")
    if not security.verify_password(user.password_hash, data.current):
        raise HTTPException(403, "La contraseña actual no es correcta.")
    problem = security.password_problem(data.new)
    if problem:
        raise HTTPException(422, problem)
    if data.new == data.current:
        raise HTTPException(422, "La contraseña nueva tiene que ser distinta.")
    user.password_hash = security.hash_password(data.new)
    user.must_change_password = False
    user.auth_version += 1  # cierra las demás sesiones
    db.query(DbSession).filter(DbSession.user_id == user.id).delete()
    A.audit(db, user, "password_changed", "", request)
    csrf = A.start_session(db, user, request, response)
    db.commit()
    return {"ok": True, "csrf": csrf}
