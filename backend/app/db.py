"""Inicialización de la base: tablas, columna de búsqueda de texto (tsvector generado + GIN) y valores por defecto."""
from sqlalchemy import text

from . import models

ACCENTS = "áéíóúüñÁÉÍÓÚÜÑ"
FOLDED = "aeiouunAEIOUUN"
# A = contexto (título/carpeta), B = cuerpo. El motor puntúa con pesos explícitos para estas dos letras.
FTS_EXPRESSION = (
    "setweight(to_tsvector('spanish'::regconfig, translate(coalesce(context_text, ''), '%(a)s', '%(f)s')), 'A') || "
    "setweight(to_tsvector('spanish'::regconfig, translate(coalesce(content, ''), '%(a)s', '%(f)s')), 'B')"
) % {"a": ACCENTS, "f": FOLDED}


# Cambios de esquema, en orden. Cada paso es idempotente y se ejecuta una sola vez por base (se anota en schema_info).
# Para cambiar la estructura en una versión nueva: agregá un paso al FINAL (nunca edites uno viejo) y actualizá models.py.
MIGRATIONS = [
    # 1: se quitó el bloqueo duro de cuentas (ahora el freno es por cuenta + IP)
    "ALTER TABLE users DROP COLUMN IF EXISTS failed_logins, DROP COLUMN IF EXISTS locked_until",
    # 2: preferencias de personalización por persona
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs text NOT NULL DEFAULT '{}'",
    # 3: libro de mejoras verificadas compartido por la empresa
    """CREATE TABLE IF NOT EXISTS xp_events (
        id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        kind VARCHAR(24) NOT NULL, ref VARCHAR(120) NOT NULL,
        xp INTEGER NOT NULL, note VARCHAR(200) NOT NULL DEFAULT '',
        UNIQUE (kind, ref));
        CREATE INDEX IF NOT EXISTS ix_xp_events_created_at ON xp_events (created_at)""",
    # 4: entrenamiento semanal y procedencia humana de las respuestas.
    """ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_notes TEXT NOT NULL DEFAULT '';
        ALTER TABLE tickets ADD COLUMN IF NOT EXISTS question TEXT NOT NULL DEFAULT '';
        ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
        ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS drafts (
          id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
          title VARCHAR(300) NOT NULL, body TEXT NOT NULL, state VARCHAR(12) NOT NULL DEFAULT 'pending',
          document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL);
        CREATE TABLE IF NOT EXISTS synonym_proposals (
          id SERIAL PRIMARY KEY, term VARCHAR(40) NOT NULL, suggested VARCHAR(40) NOT NULL,
          count INTEGER NOT NULL DEFAULT 1, state VARCHAR(12) NOT NULL DEFAULT 'pending', UNIQUE(term,suggested));
        CREATE TABLE IF NOT EXISTS xp_events (
          id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind VARCHAR(24) NOT NULL,
          ref VARCHAR(120) NOT NULL, xp INTEGER NOT NULL, note VARCHAR(200) NOT NULL DEFAULT '', UNIQUE(kind,ref));
        CREATE INDEX IF NOT EXISTS ix_xp_events_created_at ON xp_events(created_at)""",
]


def migrate(conn):
    conn.execute(text("CREATE TABLE IF NOT EXISTS schema_info (id int PRIMARY KEY, version int NOT NULL)"))
    conn.execute(text("SELECT pg_advisory_xact_lock(7002)"))
    row = conn.execute(text("SELECT version FROM schema_info WHERE id = 1")).first()
    current = row[0] if row else 0
    for number, statement in enumerate(MIGRATIONS, start=1):
        if number > current:
            conn.execute(text(statement))
    conn.execute(text("INSERT INTO schema_info (id, version) VALUES (1, :v) ON CONFLICT (id) DO UPDATE SET version = :v"),
                 {"v": len(MIGRATIONS)})


def init_db():
    engine = models.engine()
    models.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        migrate(conn)
        has = conn.execute(text("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
                                "AND table_name = 'chunks' AND column_name = 'fts'")).first()
        if not has:
            conn.execute(text("ALTER TABLE chunks ADD COLUMN fts tsvector GENERATED ALWAYS AS (%s) STORED" % FTS_EXPRESSION))
        conn.execute(text("CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING gin (fts)"))
