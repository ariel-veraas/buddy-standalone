import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import auth as A, security
from ..models import AuditLog, Group, Session as DbSession, User

router = APIRouter(prefix="/api/admin")


def view(user):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "active": user.active,
            "must_change_password": user.must_change_password, "last_login": user.last_login,
            "groups": [{"id": g.id, "name": g.name} for g in user.groups]}


class UserIn(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(min_length=1, max_length=120)
    role: str = "user"
    password: str | None = Field(default=None, max_length=200)  # sin clave: se genera una temporal
    group_ids: list[int] = []


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = None
    active: bool | None = None
    group_ids: list[int] | None = None


def _groups(db, ids):
    groups = list(db.scalars(select(Group).where(Group.id.in_(ids)))) if ids else []
    if len(groups) != len(set(ids)):
        raise HTTPException(422, "Algún grupo no existe.")
    return groups


def _last_admin(db, user):
    """No se puede dejar el sistema sin ningún administrador activo."""
    others = db.scalar(select(func.count(User.id)).where(User.role == "admin", User.active.is_(True), User.id != user.id))
    return others == 0


@router.get("/users")
def list_users(ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    return [view(u) for u in db.scalars(select(User).order_by(User.name))]


@router.post("/users")
def create_user(data: UserIn, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    email = data.email.strip().lower()
    if not A.EMAIL.match(email):
        raise HTTPException(422, "El email no es válido.")
    if data.role not in A.ROLES:
        raise HTTPException(422, "Rol inválido.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Ya existe un usuario con ese email.")
    temporary = None
    password = data.password
    if password:
        problem = security.password_problem(password)
        if problem:
            raise HTTPException(422, problem)
    else:
        password = temporary = secrets.token_urlsafe(12)
    user = User(email=email, name=data.name.strip(), role=data.role, password_hash=security.hash_password(password),
                must_change_password=True, groups=_groups(db, data.group_ids))
    db.add(user)
    db.flush()
    A.audit(db, ctx.user, "user_created", f"{email} ({data.role})", request)
    db.commit()
    return {"user": view(user), "temporary_password": temporary}  # se muestra UNA vez


@router.patch("/users/{user_id}")
def update_user(user_id: int, data: UserPatch, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "No existe ese usuario.")
    if data.role is not None:
        if data.role not in A.ROLES:
            raise HTTPException(422, "Rol inválido.")
        if user.role == "admin" and data.role != "admin" and _last_admin(db, user):
            raise HTTPException(409, "Tiene que quedar al menos un administrador.")
        if data.role != user.role:
            user.role = data.role
            user.auth_version += 1
            user.perm_version += 1
    if data.active is not None and data.active != user.active:
        if not data.active and user.role == "admin" and _last_admin(db, user):
            raise HTTPException(409, "Tiene que quedar al menos un administrador activo.")
        if not data.active and user.id == ctx.user.id:
            raise HTTPException(409, "No podés desactivarte a vos mismo.")
        user.active = data.active
        user.auth_version += 1
    if data.name is not None:
        user.name = data.name.strip()
    if data.group_ids is not None:
        user.groups = _groups(db, data.group_ids)
        user.perm_version += 1  # cambió lo que puede leer: sus conversaciones anteriores dejan de valer
    A.audit(db, ctx.user, "user_updated", user.email, request)
    db.commit()
    return view(user)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "No existe ese usuario.")
    temporary = secrets.token_urlsafe(12)
    user.password_hash = security.hash_password(temporary)
    user.must_change_password = True
    user.auth_version += 1
    db.query(DbSession).filter(DbSession.user_id == user.id).delete()
    A.audit(db, ctx.user, "password_reset", user.email, request)
    db.commit()
    return {"temporary_password": temporary}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "No existe ese usuario.")
    if user.id == ctx.user.id:
        raise HTTPException(409, "No podés borrarte a vos mismo.")
    if user.role == "admin" and _last_admin(db, user):
        raise HTTPException(409, "Tiene que quedar al menos un administrador.")
    A.audit(db, ctx.user, "user_deleted", user.email, request)
    db.delete(user)
    db.commit()
    return {"ok": True}


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.get("/groups")
def list_groups(ctx=Depends(A.staff), db=Depends(A.get_db)):
    return [{"id": g.id, "name": g.name, "members": len(g.members)} for g in db.scalars(select(Group).order_by(Group.name))]


@router.post("/groups")
def create_group(data: GroupIn, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    name = data.name.strip()
    if db.scalar(select(Group).where(func.lower(Group.name) == name.lower())):
        raise HTTPException(409, "Ya existe un grupo con ese nombre.")
    group = Group(name=name)
    db.add(group)
    A.audit(db, ctx.user, "group_created", name, request)
    db.commit()
    return {"id": group.id, "name": group.name, "members": 0}


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, request: Request, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(404, "No existe ese grupo.")
    for member in group.members:
        member.perm_version += 1
    A.audit(db, ctx.user, "group_deleted", group.name, request)
    db.delete(group)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def audit_log(limit: int = 100, ctx=Depends(A.admin_only), db=Depends(A.get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(max(1, min(limit, 500))))
    return [{"at": r.created_at, "actor": r.actor_email, "action": r.action, "detail": r.detail, "ip": r.ip} for r in rows]
