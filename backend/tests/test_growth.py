from datetime import timedelta

from sqlalchemy import text

from app import db, models
from app.models import EvalCase, EvalRun, GapState, Insight, XpEvent, now
from app.services import growth as G, search
from tests.test_api_flow import api, app_client, make_user  # noqa: F401
from tests.test_quality import seed_unanswered, upload


def test_award_idempotent(dbs):
    assert G.award(dbs, "topic_verified", "case:1")
    assert not G.award(dbs, "topic_verified", "case:1")
    assert dbs.query(XpEvent).count() == 1
    assert G.total_xp(dbs) == 15
    dbs.commit()
    assert not G.award(dbs, "topic_verified", "case:1")


def test_daily_real_search_no_ai_and_summary(api, dbs, monkeypatch):
    doc = upload(api)
    dbs.add(EvalCase(question="días de vacaciones", document_id=doc, origin="gap"))
    dbs.commit()
    def forbidden(*args, **kwargs):
        raise AssertionError("No debe llamar a IA")
    monkeypatch.setattr(search.embed, "semantic_rows", forbidden)
    out = G.daily(dbs)
    dbs.commit()
    assert out["ran"] and out["passed"] == out["total"] == 1
    assert {e["kind"] for e in out["awarded"]} == {"topic_verified", "first_green_run"}
    assert G.daily(dbs)["awarded"] == []
    dbs.commit()
    assert G.total_xp(dbs) == 35
    assert G.last_daily(dbs)["passed"] == 1
    assert G.daily(dbs, scheduled=True) is None
    assert api.call("get", "/api/growth").json()["xp"] == 35


def test_recovery_weekly_and_regressions(dbs, monkeypatch):
    case = EvalCase(question="vacaciones", origin="gap", last_ok=False)
    dbs.add(case)
    dbs.commit()
    passing = [True]
    monkeypatch.setattr(search, "retrieve", lambda *args, **kwargs: [{"doc_id":1}] if passing[0] else [])
    date = now()
    monkeypatch.setattr(G, "now", lambda: date)
    first = G.daily(dbs)
    dbs.commit()
    assert len(first["awarded"]) == 3 and G.total_xp(dbs) == 45
    assert first["leveled_up"] and first["before_level"] == 1 and first["after_level"] == 2
    passing[0] = False
    assert G.daily(dbs)["regressions"] == 1
    dbs.commit()
    assert G.total_xp(dbs) == 45
    passing[0] = True
    assert G.daily(dbs)["awarded"] == []
    dbs.commit()
    passing[0] = False
    G.daily(dbs)
    dbs.commit()
    date += timedelta(days=7)
    passing[0] = True
    assert [e["kind"] for e in G.daily(dbs)["awarded"]] == ["test_recovered"]


def test_first_green_after_manual_run_still_awarded_once(dbs, monkeypatch):
    # una prueba manual en Calidad ya dejó una corrida verde: el bonus igual se otorga, una sola vez
    dbs.add_all([EvalCase(question="vacaciones"), EvalRun(total=1, passed=1)])
    dbs.commit()
    monkeypatch.setattr(search, "retrieve", lambda *args: [{"doc_id":1}])
    first = G.daily(dbs)
    dbs.commit()
    assert [e["kind"] for e in first["awarded"]] == ["first_green_run"]
    assert G.daily(dbs)["awarded"] == []


def test_empty_and_coverage_once(dbs):
    current = now()
    dbs.add_all([Insight(outcome="undocumented", created_at=current-timedelta(days=10)) for _ in range(10)])
    dbs.add_all([Insight(outcome="answered", created_at=current-timedelta(days=1)) for _ in range(10)])
    dbs.commit()
    out = G.daily(dbs)
    dbs.commit()
    assert not out["ran"] and out["total"] == 0
    assert [e["kind"] for e in out["awarded"]] == ["coverage_up"]
    assert dbs.query(EvalRun).count() == 0
    assert G.daily(dbs)["awarded"] == []


def test_auth_csrf_and_audit(api, dbs):
    assert api.c.post("/api/growth/run").status_code == 403
    assert api.call("post", "/api/growth/run").status_code == 200
    assert dbs.query(models.AuditLog).filter_by(action="growth_run").count() == 1
    make_user(api, "ana@x.com")
    api.ready("ana@x.com")
    assert api.call("get", "/api/growth").status_code == 200
    assert api.call("post", "/api/growth/run").status_code == 403
    api.c.cookies.clear()
    assert api.call("get", "/api/growth").status_code == 401
    assert api.call("post", "/api/growth/run").status_code == 401


def test_migration_old_schema_idempotent(dbs):
    with models.engine().begin() as conn:
        conn.execute(text("DROP TABLE xp_events"))
        conn.execute(text("UPDATE schema_info SET version = :v"), {"v":len(db.MIGRATIONS)-1})
        db.migrate(conn)
        db.migrate(conn)
        conn.execute(text("INSERT INTO xp_events(kind, ref, xp) VALUES ('topic_verified', 'old', 15)"))
        conn.execute(text("INSERT INTO xp_events(kind, ref, xp) VALUES ('topic_verified', 'old', 15) ON CONFLICT DO NOTHING"))
        assert conn.execute(text("SELECT count(*) FROM xp_events")).scalar() == 1
    assert G.status(dbs)["xp"] == 15


def test_failed_search_does_not_award(dbs, monkeypatch):
    import pytest
    dbs.add(EvalCase(question="vacaciones", origin="gap"))
    dbs.commit()
    def broken(*args):
        raise RuntimeError("búsqueda rota")
    monkeypatch.setattr(search, "retrieve", broken)
    with pytest.raises(RuntimeError):
        G.daily(dbs)
    dbs.rollback()
    assert G.total_xp(dbs) == 0 and G.last_daily(dbs) is None


def test_schedule_survives_restart_and_next_day(dbs, monkeypatch):
    from datetime import datetime
    class Clock:
        current = datetime(2026, 10, 7, 23, 59)

        @classmethod
        def now(cls):
            return cls.current

    monkeypatch.setattr(G, "datetime", Clock)
    assert G.daily(dbs, scheduled=True) is not None
    dbs.commit()
    with models.session() as restarted:
        assert G.daily(restarted, scheduled=True) is None
        restarted.commit()
        Clock.current += timedelta(minutes=2)
        assert G.daily(restarted, scheduled=True) is not None
        restarted.commit()


def test_status_recent_shared(dbs):
    for number in range(12):
        G.award(dbs, "topic_verified", f"case:{number}")
    out = G.status(dbs)
    assert out["xp"] == 180 and len(out["recent"]) == 10
    assert out["stage"] == "cria"
    assert out["recent"][0]["ref"] == "case:11"


def test_dex_empty_and_staff_auth(api):
    empty = {"registered": [], "unknown": [], "total_seen": 0, "completion": 0}
    assert api.call("get", "/api/growth/dex").json() == empty
    make_user(api, "editor@x.com", role="editor")
    make_user(api, "ana@x.com")
    api.ready("editor@x.com")
    assert api.call("get", "/api/growth/dex").json() == empty
    api.ready("ana@x.com")
    assert api.call("get", "/api/growth/dex").status_code == 403
    api.c.cookies.clear()
    assert api.call("get", "/api/growth/dex").status_code == 401


def test_dex_resolved_open_shape_and_current_verification(api, dbs):
    seed_unanswered(dbs)
    groups = G.quality.gaps(dbs, 30)["groups"]
    vacation = next(group for group in groups if "vacaciones" in group["terms"])
    dbs.add_all([GapState(key=vacation["key"], state="resolved", note="Vacaciones", changed_at=now()+timedelta(seconds=1)),
                 GapState(key="manual", state="resolved"), GapState(key="fallo", state="resolved"),
                 GapState(key="ignorado", state="ignored"),
                 EvalCase(question="Cuántos días de vacaciones tengo", origin="gap", last_ok=True),
                 EvalCase(question="manual", origin="manual", last_ok=True),
                 EvalCase(question="fallo", origin="gap", last_ok=False)])
    dbs.commit()
    out = api.call("get", "/api/growth/dex").json()
    registered = {entry["key"]: entry for entry in out["registered"]}
    assert len(registered) == 3 and "ignorado" not in registered
    assert registered[vacation["key"]]["verified"] is True
    assert registered["manual"]["verified"] is False and registered["fallo"]["verified"] is False
    assert registered[vacation["key"]]["note"] == "Vacaciones"
    assert set(registered[vacation["key"]]) == {"key", "note", "changed_at", "verified"}
    assert len(out["unknown"]) == 1 and out["unknown"][0]["count"] == 2
    assert set(out["unknown"][0]) == {"key", "terms", "count"}
    assert out["total_seen"] == 4 and out["completion"] == 0.75
    case = dbs.query(EvalCase).filter_by(origin="gap", last_ok=True).one()
    case.last_ok = False
    dbs.commit()
    assert not next(entry for entry in G.dex(dbs)["registered"] if entry["key"] == vacation["key"])["verified"]


def test_dex_includes_returned_gaps(dbs):
    seed_unanswered(dbs)
    group = G.quality.gaps(dbs, 30)["groups"][0]
    dbs.add(GapState(key=group["key"], state="resolved", changed_at=now()-timedelta(days=1)))
    dbs.commit()
    out = G.dex(dbs)
    assert any(entry["key"] == group["key"] for entry in out["registered"])
    assert any(entry["key"] == group["key"] and entry["count"] == group["count"] for entry in out["unknown"])
    assert out["total_seen"] == len(out["registered"]) + len(out["unknown"])
