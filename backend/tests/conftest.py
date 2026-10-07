import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://buddy:buddy@localhost:55432/buddy_test")
os.environ.setdefault("BUDDY_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", ".test-data"))
os.environ.setdefault("BUDDY_COOKIE_SECURE", "0")


@pytest.fixture(scope="session")
def _schema():
    from sqlalchemy import text
    from app import db, models
    engine = models.engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    db.init_db()
    yield


@pytest.fixture()
def dbs(_schema):
    """Sesión de base limpia por test."""
    from sqlalchemy import text
    from app import models
    with models.engine().begin() as conn:
        conn.execute(text("TRUNCATE users, groups, collections, settings, insights, contacts, audit_log, feedback, sessions, usage, tickets, eval_cases, eval_runs, gap_states, xp_events "
                          "RESTART IDENTITY CASCADE"))
    s = models.session()
    yield s
    s.close()
