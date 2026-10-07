from datetime import timedelta

from app import models
from app.models import Feedback, Insight, Message, Session as DbSession, User, now
from app.services import maintenance


def test_purge_removes_expired_and_unlinks_old_votes(dbs):
    user = User(email="a@x.com", name="A", password_hash="x")
    dbs.add(user)
    dbs.flush()
    old, fresh = now() - timedelta(minutes=30), now()
    fb_old, fb_new = Feedback(day="2026-10-07", code_hash="a" * 64, vote=1), Feedback(day="2026-10-07", code_hash="b" * 64, vote=1)
    dbs.add_all([fb_old, fb_new])
    dbs.flush()
    dbs.add_all([
        DbSession(token_hash="1" * 64, csrf="c", user_id=user.id, auth_version=1, expires_at=now() - timedelta(hours=1)),
        DbSession(token_hash="2" * 64, csrf="c", user_id=user.id, auth_version=1, expires_at=now() + timedelta(hours=1)),
        Insight(created_at=now() - timedelta(days=400)), Insight(created_at=now()),
        Message(user_id=user.id, role="assistant", content="viejo", feedback_id=fb_old.id, feedback_vote="up", feedback_at=old, feedback_token="t" * 20),
        Message(user_id=user.id, role="assistant", content="nuevo", feedback_id=fb_new.id, feedback_vote="up", feedback_at=fresh, feedback_token="u" * 20),
    ])
    dbs.commit()
    out = maintenance.purge(dbs)
    assert out["sessions"] == 1 and out["insights"] == 1 and out["votes_unlinked"] == 1
    rows = {m.content: m for m in dbs.query(Message)}
    assert rows["viejo"].feedback_id is None and rows["viejo"].feedback_vote == "up"  # el voto sigue visible para quien lo dio
    assert rows["nuevo"].feedback_id == fb_new.id
    assert dbs.query(Feedback).count() == 2  # los votos anónimos se conservan para las estadísticas


def test_migrations_upgrade_an_old_schema_and_are_idempotent(dbs):
    from sqlalchemy import text
    from app import db
    with models.engine().begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN failed_logins int NOT NULL DEFAULT 0"))
        conn.execute(text("DELETE FROM schema_info"))
    db.init_db()
    db.init_db()
    with models.engine().begin() as conn:
        cols = {r[0] for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"))}
        assert "failed_logins" not in cols
        assert conn.execute(text("SELECT version FROM schema_info")).scalar() == len(db.MIGRATIONS)
