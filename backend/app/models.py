"""Modelo de datos (SQLAlchemy 2, PostgreSQL)."""
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint,
                        create_engine)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from . import config


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(10), default="user")  # admin | editor | user
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Sube al cambiar la contraseña o desactivar: invalida las sesiones y conversaciones anteriores.
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    # Conversación actual: sube al olvidarla o cuando cambian los permisos (así nada viejo se mezcla con lo nuevo).
    chat_generation: Mapped[int] = mapped_column(Integer, default=1)
    # perm_version sube cuando cambia lo que la persona puede leer (grupos, colecciones); la sesión NO se cierra por eso.
    perm_version: Mapped[int] = mapped_column(Integer, default=1)
    chat_perm_version: Mapped[int] = mapped_column(Integer, default=1)
    # Preferencias cosméticas de la persona (fondo, tinte, accesorio, cariño, racha) como JSON.
    prefs: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    groups: Mapped[list["Group"]] = relationship(secondary="group_members", back_populates="members")


class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    members: Mapped[list[User]] = relationship(secondary="group_members", back_populates="groups")


class GroupMember(Base):
    __tablename__ = "group_members"
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    auth_version: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Collection(Base):
    """Un conjunto de documentos (antes «carpeta»): subida manual o carpeta de Google Drive."""
    __tablename__ = "collections"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(10), default="upload")  # upload | drive
    drive_folder: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # "all": cualquier usuario; "groups": solo los grupos listados (sin grupos = solo administradores/editores).
    visibility: Mapped[str] = mapped_column(String(10), default="groups")
    state: Mapped[str] = mapped_column(String(12), default="idle")  # idle | syncing | error
    error: Mapped[str | None] = mapped_column(Text)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    groups: Mapped[list[Group]] = relationship(secondary="collection_groups")


class CollectionGroup(Base):
    __tablename__ = "collection_groups"
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("collection_id", "external_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(200))  # id de Drive o hash del archivo subido
    name: Mapped[str] = mapped_column(String(300))
    path: Mapped[str] = mapped_column(String(600), default="")
    mime: Mapped[str] = mapped_column(String(120), default="")
    web_view_link: Mapped[str] = mapped_column(String(600), default="")
    modified_time: Mapped[str] = mapped_column(String(40), default="")
    stamp: Mapped[str] = mapped_column(String(200), default="")  # huella: si no cambió no se reindexa
    state: Mapped[str] = mapped_column(String(12), default="ready")  # ready | error | skipped
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    context_text: Mapped[str] = mapped_column(Text, default="")  # título/carpeta: se indexa con más peso
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
    embedding_hash: Mapped[str | None] = mapped_column(String(64))
    embedding_model: Mapped[str | None] = mapped_column(String(120))
    # La columna `fts` (tsvector generado + índice GIN) la crea db.init_db(): SQLAlchemy no la necesita mapeada.


Index("ix_chunks_doc_seq", Chunk.document_id, Chunk.sequence)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    secret: Mapped[bool] = mapped_column(Boolean, default=False)  # cifrado en reposo, write-only desde la API


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    generation: Mapped[int] = mapped_column(Integer, default=1)
    request_id: Mapped[str | None] = mapped_column(String(64))
    response_json: Mapped[dict | None] = mapped_column(JSON)
    feedback_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    feedback_context: Mapped[dict | None] = mapped_column(JSON)
    feedback_vote: Mapped[str | None] = mapped_column(String(4))
    feedback_id: Mapped[int | None] = mapped_column(ForeignKey("feedback.id", ondelete="SET NULL"))
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    feedback_changes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    """Voto 👍/👎 ANÓNIMO: sin usuario, sin hora (solo el día) y atado a la respuesta por un código opaco."""
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[str] = mapped_column(String(10))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    vote: Mapped[int] = mapped_column(Integer)  # 1 | -1
    reason: Mapped[str | None] = mapped_column(String(300))
    document_ids: Mapped[list | None] = mapped_column(JSON)
    model: Mapped[str | None] = mapped_column(String(120))
    question: Mapped[str | None] = mapped_column(Text)


class Insight(Base):
    """Estadística de cada consulta (sin texto de la pregunta salvo que el admin lo active)."""
    __tablename__ = "insights"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    model: Mapped[str] = mapped_column(String(120), default="")
    question: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(String(20), default="answered")  # answered | undocumented | unsure | error
    error: Mapped[str | None] = mapped_column(String(40))
    chunks: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)


class Contact(Base):
    """A quién escalar cuando Buddy no sabe (rol → persona), lo ve el usuario en la respuesta."""
    __tablename__ = "contacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    label: Mapped[str] = mapped_column(String(80), default="")
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), default="")
    note: Mapped[str] = mapped_column(String(200), default="")


class Usage(Base):
    """Libro de consultas: cupos por persona, tope del sistema, idempotencia por request_id y «en curso» con alquiler."""
    __tablename__ = "usage"
    __table_args__ = (UniqueConstraint("user_id", "request_id"), Index("ix_usage_user_created", "user_id", "created_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    request_id: Mapped[str] = mapped_column(String(64))
    generation: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(10), default="reserved")  # reserved | done | failed
    error_code: Mapped[str | None] = mapped_column(String(40))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Ticket(Base):
    """Consulta que Buddy no pudo resolver y la persona pidió escalar a un humano."""
    __tablename__ = "tickets"
    __table_args__ = (UniqueConstraint("user_id", "request_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    request_key: Mapped[str | None] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(10), default="new")  # new | progress | done
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    staff_notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    question: Mapped[str] = mapped_column(Text, default="", server_default="")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_email: Mapped[str] = mapped_column(String(254), default="")
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(400), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")


_engine = None
_Session = None


def engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(config.DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10)
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def session():
    engine()
    return _Session()


class GapState(Base):
    """Estado de un tema que la gente preguntó y Buddy no pudo responder («Qué falta documentar»)."""
    __tablename__ = "gap_states"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)  # palabra madre del grupo (normalizada)
    state: Mapped[str] = mapped_column(String(12), default="resolved")  # resolved | ignored
    note: Mapped[str] = mapped_column(String(200), default="")
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EvalCase(Base):
    """Una pregunta de la prueba de calidad: ¿Buddy encuentra hoy dónde está la respuesta?"""
    __tablename__ = "eval_cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(500))
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))  # dónde debería estar
    origin: Mapped[str] = mapped_column(String(12), default="manual")  # gap | manual
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_checked: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EvalRun(Base):
    """Una corrida de la prueba: cuántas pasaron y con qué configuración (para comparar antes y después)."""
    __tablename__ = "eval_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[str] = mapped_column(String(300), default="")
    regressions: Mapped[int] = mapped_column(Integer, default=0)


class XpEvent(Base):
    """Mejora verificada: un solo premio por tipo y referencia para toda la empresa."""
    __tablename__ = "xp_events"
    __table_args__ = (UniqueConstraint("kind", "ref"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    kind: Mapped[str] = mapped_column(String(24))
    ref: Mapped[str] = mapped_column(String(120))
    xp: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(200), default="")


class Draft(Base):
    """Propuesta desde una respuesta humana; requiere aprobación antes de indexarse."""
    __tablename__ = "drafts"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(12), default="pending")
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))


class SynonymProposal(Base):
    """Relación sugerida, sin modificar la búsqueda hasta que una persona la apruebe."""
    __tablename__ = "synonym_proposals"
    __table_args__ = (UniqueConstraint("term", "suggested"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    term: Mapped[str] = mapped_column(String(40))
    suggested: Mapped[str] = mapped_column(String(40))
    count: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(12), default="pending")
