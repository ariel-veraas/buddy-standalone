"""Entrenamiento semanal: fuentes humanas, revisión y límites reales sin IA externa."""
from datetime import datetime, timedelta, timezone
import json

import pytest
from sqlalchemy import select, text

from app import db, models
from app.core.growth_logic import medals
from app.models import Draft, EvalCase, Setting, SynonymProposal, Ticket, User, Usage, now
from app.services import growth as G, settings as S
from tests.test_api_flow import api, app_client, configure, make_user  # noqa: F401


@pytest.mark.parametrize("ident,key,target", [
    ("primer_paso", "verified_topics", 1), ("biblioteca", "registered_topics", 10),
    ("sin_regresiones", "daily_streak", 4), ("nivel_5", "level", 5),
    ("nivel_10", "level", 10), ("evolucion", "level", 7),
    ("honesto", "coverage_up", 3), ("entrenado", "weekly_sessions", 3),
])
def test_medals_boundaries_and_purity(ident, key, target):
    for value in (-1, 0, target - 1, target, target + 20):
        stats = {key: value}
        snapshot = dict(stats)
        out = medals(stats)
        assert len(out) == 8 and len({m["id"] for m in out}) == 8
        medal = next(m for m in out if m["id"] == ident)
        assert medal["earned"] is (value >= target)
        assert medal["progress"] == min(target, max(0, value))
        assert medal["target"] == target
        assert set(medal) == {"id", "name", "desc", "earned", "progress", "target"}
        assert stats == snapshot


def human_ticket(dbs, *, notes="Cada empleado tiene 14 días de vacaciones al año.", **changes):
    user = dbs.scalar(select(User).order_by(User.id))
    values = dict(user_id=user.id, name="Vacaciones", description="¿Cuántos días de vacaciones tengo?",
                  state="done", staff_notes=notes, resolved_by=user.id, resolved_at=now())
    values.update(changes)
    ticket = Ticket(**values)
    dbs.add(ticket)
    dbs.commit()
    return ticket


def pending_draft(dbs):
    ticket = human_ticket(dbs)
    draft = Draft(ticket_id=ticket.id, title="Vacaciones", body=ticket.staff_notes)
    dbs.add(draft)
    dbs.commit()
    return draft, ticket


def test_draft_approval_ingests_and_defers_xp_until_verified(api, dbs):
    draft, ticket = pending_draft(dbs)
    col = api.call("post", "/api/collections", json={"name": "RRHH", "visibility": "all"}).json()["id"]
    assert api.call("put", f"/api/growth/drafts/{draft.id}", json={"state": "approved"}).status_code == 422
    out = api.call("put", f"/api/growth/drafts/{draft.id}", json={"state": "approved", "collection_id": col,
        "title": "Vacaciones anuales", "body": "Cada empleado tiene 14 días de vacaciones al año. Pedí vacaciones a RRHH."})
    assert out.status_code == 200, out.text
    dbs.expire_all()
    saved = dbs.get(Draft, draft.id)
    assert saved.state == "approved" and saved.document_id
    doc = dbs.get(models.Document, saved.document_id)
    assert doc.collection_id == col and doc.state == "ready"
    assert dbs.query(models.Chunk).filter_by(document_id=doc.id).count() > 0
    case = dbs.query(EvalCase).filter_by(document_id=doc.id).one()
    assert case.question == ticket.description and case.origin == "gap" and case.last_ok is None
    assert G.total_xp(dbs) == 0
    G.daily(dbs)
    dbs.commit()
    assert dbs.get(EvalCase, case.id).last_ok is True
    assert dbs.query(models.XpEvent).filter_by(kind="topic_verified", ref=f"case:{case.id}").count() == 1
    xp = G.total_xp(dbs)
    G.daily(dbs)
    dbs.commit()
    assert G.total_xp(dbs) == xp


def test_reject_draft_leaves_knowledge_untouched(api, dbs):
    draft, _ = pending_draft(dbs)
    assert api.call("put", f"/api/growth/drafts/{draft.id}", json={"state": "rejected"}).status_code == 200
    dbs.expire_all()
    assert dbs.get(Draft, draft.id).state == "rejected"
    assert dbs.query(models.Document).count() == dbs.query(EvalCase).count() == G.total_xp(dbs) == 0


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/growth/weekly", None), ("post", "/api/growth/weekly/run", None),
    ("get", "/api/growth/drafts?state=pending", None), ("put", "/api/growth/drafts/1", {"state": "rejected"}),
    ("get", "/api/growth/synonyms", None), ("put", "/api/growth/synonyms/1", {"state": "rejected"}),
])
def test_training_endpoints_require_staff_and_auth(api, method, path, body):
    make_user(api, "ordinary@x.com")
    api.ready("ordinary@x.com")
    kwargs = {"json": body} if body is not None else {}
    assert api.call(method, path, **kwargs).status_code == 403
    api.c.cookies.clear()
    assert api.call(method, path, **kwargs).status_code == 401


def test_training_write_csrf(api):
    for path, body in (("/api/growth/weekly/run", {}), ("/api/growth/drafts/1", {"state": "rejected"}),
                       ("/api/growth/synonyms/1", {"state": "rejected"})):
        method = "post" if path.endswith("run") else "put"
        assert getattr(api.c, method)(path, json=body).status_code == 403


def test_synonym_approval_uses_existing_search_mechanism(api, dbs):
    from app.core.text import all_synonyms, query_groups
    proposal = SynonymProposal(term="licensia", suggested="vacaciones", count=3)
    dbs.add(proposal)
    dbs.commit()
    assert api.call("put", f"/api/growth/synonyms/{proposal.id}", json={"state": "approved"}).status_code == 200
    dbs.expire_all()
    raw = S.raw(dbs, "synonyms")
    groups = query_groups("licensia", all_synonyms(raw))
    assert any(("vacaciones",) in group for group in groups)
    assert dbs.get(SynonymProposal, proposal.id).state == "approved"
    assert G.total_xp(dbs) == 0


def test_weekly_migration_idempotent(dbs):
    with models.engine().begin() as conn:
        conn.execute(text("DROP TABLE drafts, synonym_proposals"))
        conn.execute(text("ALTER TABLE tickets DROP COLUMN staff_notes, DROP COLUMN resolved_at, DROP COLUMN resolved_by"))
        conn.execute(text("UPDATE schema_info SET version = :v"), {"v": len(db.MIGRATIONS)-1})
        db.migrate(conn)
        db.migrate(conn)
        assert conn.execute(text("SELECT count(*) FROM drafts")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM synonym_proposals")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name='tickets' "
                                 "AND column_name IN ('staff_notes', 'resolved_at', 'resolved_by')")).scalar() == 3


class DraftProvider:
    """Proveedor local sin red; registra exactamente lo que recibiría el modelo."""
    def __init__(self, response=None, error=None):
        self.messages = []
        self.response = response or json.dumps({"title": "Vacaciones", "body": "Cada empleado tiene 14 días de vacaciones al año."})
        self.error = error

    def _chat(self, model, messages, timeout, **kwargs):
        self.messages.append(messages)
        assert sum(len(m["content"]) for m in messages) < 7000
        if self.error:
            raise self.error
        kwargs["usage"].update({"in": 12, "out": 15})
        return self.response


def test_weekly_no_provider_runs_daily_and_non_ai_steps(api, dbs, monkeypatch):
    human_ticket(dbs)
    def forbidden(*args, **kwargs):
        raise AssertionError("La IA sin configurar no debe invocarse")
    monkeypatch.setattr(G.chat, "provider_for", forbidden)
    out = G.weekly(dbs)
    dbs.commit()
    assert out["ai"]["status"] == "not_configured" and out["ai"]["calls"] == 0
    assert "Sin proveedor" in out["summary"] and out["variants"] == []
    assert G.last_daily(dbs) is not None and dbs.query(Draft).count() == 0
    assert G.weekly_view(dbs)["last"] == out


def test_weekly_scheduled_restart_and_manual_no_duplicate_award(api, dbs, monkeypatch):
    dbs.add(EvalCase(question="vacaciones", origin="gap"))
    dbs.commit()
    monkeypatch.setattr(G.search, "retrieve", lambda *a, **k: [{"doc_id": 1}])
    out = G.weekly(dbs, scheduled=True)
    dbs.commit()
    xp = G.total_xp(dbs)
    assert xp == 35 and out["xp_gained"] == 35
    with models.session() as restarted:
        assert G.weekly(restarted, scheduled=True) is None
        restarted.commit()
        repeated = G.weekly(restarted)
        restarted.commit()
        assert G.total_xp(restarted) == xp
        assert repeated["level_before"] == out["level_before"]
        assert len(G.weekly_view(restarted)["history"]) == 1
        assert S.raw(restarted, "growth_weekly_count") == "1"


def test_weekly_history_keeps_eight_unique_iso_weeks(api, dbs, monkeypatch):
    current = datetime(2026, 10, 7, tzinfo=timezone.utc)
    monkeypatch.setattr(G, "now", lambda: current)
    for _ in range(10):
        G.weekly(dbs)
        dbs.commit()
        current += timedelta(days=7)
    history = G.weekly_view(dbs)["history"]
    assert len(history) == 8 and len({s["week"] for s in history}) == 8
    assert history[0]["week"] == "2026-W50"
    assert S.raw(dbs, "growth_weekly_count") == "10"
    assert next(m for m in G.status(dbs)["medals"] if m["id"] == "entrenado")["earned"]


def test_weekly_cap_is_shared_with_chat_and_still_does_search(api, dbs, monkeypatch):
    configure(api)
    human_ticket(dbs)
    S.set_many(dbs, {"max_daily_total": "1"})
    user = dbs.scalar(select(User).order_by(User.id))
    dbs.add(Usage(user_id=user.id, request_id="already-spent", state="done"))
    dbs.add(EvalCase(question="vacaciones", origin="gap"))
    dbs.commit()
    provider = DraftProvider()
    monkeypatch.setattr(G.chat, "provider_for", lambda factory: provider)
    monkeypatch.setattr(G.search, "retrieve", lambda *a, **k: [{"doc_id": 1}])
    out = G.weekly(dbs)
    dbs.commit()
    assert out["ai"]["status"] == "system_limit" and out["ai"]["calls"] == 0
    assert "tope" in out["summary"] and not provider.messages
    assert len(out["variants"]) == 3 and G.total_xp(dbs) == 35
    assert dbs.query(Draft).count() == 0 and dbs.query(Usage).count() == 1


def test_weekly_only_human_resolved_recent_material_and_masking(api, dbs, monkeypatch):
    configure(api)
    user_id = make_user(api, "ordinary@x.com")
    valid = human_ticket(dbs, notes="Escribí a soporte@empresa.com, teléfono 1155554444. Se permiten 14 días.",
                         description="Mi correo es ana@empresa.com y necesito vacaciones.")
    human_ticket(dbs, notes="")
    human_ticket(dbs, state="new")
    human_ticket(dbs, resolved_at=now()-timedelta(days=15))
    human_ticket(dbs, resolved_by=None)
    human_ticket(dbs, resolved_by=user_id)
    provider = DraftProvider()
    monkeypatch.setattr(G.chat, "provider_for", lambda factory: provider)
    out = G.weekly(dbs)
    dbs.commit()
    assert out["ai"]["calls"] == len(provider.messages) == 1
    draft = dbs.query(Draft).one()
    assert draft.ticket_id == valid.id
    prompt = json.dumps(provider.messages, ensure_ascii=False)
    assert "ana@empresa.com" not in prompt and "soporte@empresa.com" not in prompt and "1155554444" not in prompt
    assert "[correo]" in prompt and "[número]" in prompt
    assert "14 días" in prompt
    assert dbs.query(models.Document).count() == 0
    assert dbs.query(models.Insight).filter_by(tokens_in=12, tokens_out=15, question=None).count() == 1
    G.weekly(dbs)
    dbs.commit()
    assert len(provider.messages) == 1 and dbs.query(Draft).count() == 1


@pytest.mark.parametrize("response", ["no es JSON", '{"title":"","body":"no hay información suficiente"}',
                                     '{"title":"Sin datos","body":"no hay información suficiente"}'])
def test_weekly_discards_invalid_and_insufficient_drafts(api, dbs, monkeypatch, response):
    configure(api)
    human_ticket(dbs)
    provider = DraftProvider(response=response)
    monkeypatch.setattr(G.chat, "provider_for", lambda factory: provider)
    out = G.weekly(dbs)
    dbs.commit()
    assert out["ai"]["calls"] == 1 and dbs.query(Draft).count() == 0
    assert dbs.query(Usage).count() == 1


def test_weekly_hard_call_and_input_limits(api, dbs, monkeypatch):
    configure(api)
    for _ in range(12):
        human_ticket(dbs, description="vacaciones "*1000, notes="14 días anuales "*1000)
    provider = DraftProvider()
    monkeypatch.setattr(G.chat, "provider_for", lambda factory: provider)
    out = G.weekly(dbs)
    dbs.commit()
    assert out["ai"]["calls"] == len(provider.messages) == G.MAX_AI_CALLS <= 10
    assert dbs.query(Draft).count() == G.MAX_AI_CALLS
    for messages in provider.messages:
        material = messages[-1]["content"]
        assert len(material) <= G.MAX_AI_INPUT
        assert "14 días" in material


def test_settings_experiment_changes_nothing(api, dbs, monkeypatch):
    cases = [EvalCase(question="vacaciones", last_ok=False), EvalCase(question="aguinaldo", last_ok=True)]
    dbs.add_all(cases)
    S.set_many(dbs, {"top_k": "5"})
    dbs.commit()
    settings_before = [(s.key, s.value) for s in dbs.scalars(select(Setting).order_by(Setting.key))]
    calls = []
    def retrieve(db, user, question, cfg):
        calls.append(cfg["top_k"])
        return [{"doc_id": 1}] if cfg["top_k"] >= 5 else []
    monkeypatch.setattr(G.search, "retrieve", retrieve)
    variants = G.settings_experiment(dbs)
    dbs.commit()
    assert variants == [{"top_k": 5, "passed": 2, "total": 2}, {"top_k": 7, "passed": 2, "total": 2},
                        {"top_k": 3, "passed": 0, "total": 2}]
    assert calls == [5, 5, 7, 7, 3, 3]
    assert [(s.key, s.value) for s in dbs.scalars(select(Setting).order_by(Setting.key))] == settings_before
    assert [dbs.get(EvalCase, c.id).last_ok for c in cases] == [False, True]
    assert dbs.query(models.EvalRun).count() == G.total_xp(dbs) == 0


def test_editor_only_targets_active_manual_collections(api, dbs):
    draft, _ = pending_draft(dbs)
    manual = api.call("post", "/api/collections", json={"name": "Manual", "visibility": "groups"}).json()["id"]
    inactive = api.call("post", "/api/collections", json={"name": "Inactiva", "active": False}).json()["id"]
    drive = api.call("post", "/api/collections", json={"name": "Drive", "kind": "drive", "drive_folder": "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"}).json()["id"]
    make_user(api, "editor@x.com", role="editor")
    api.ready("editor@x.com")
    for cid in (inactive, drive):
        out = api.call("put", f"/api/growth/drafts/{draft.id}", json={"state": "approved", "collection_id": cid})
        assert out.status_code == 403, out.text
    assert api.call("put", f"/api/growth/drafts/{draft.id}", json={"state": "approved", "collection_id": manual}).status_code == 200


def test_weekly_manual_is_audited_and_lists_are_staff_accessible(api, dbs):
    assert api.call("get", "/api/growth/weekly").json() == {"last": None, "history": []}
    assert api.call("post", "/api/growth/weekly/run").status_code == 200
    assert dbs.query(models.AuditLog).filter_by(action="growth_weekly_run").count() == 1
    make_user(api, "editor@x.com", role="editor")
    api.ready("editor@x.com")
    for path in ("/api/growth/weekly", "/api/growth/drafts", "/api/growth/synonyms"):
        assert api.call("get", path).status_code == 200


def test_daily_regression_medal_counts_distinct_runs(api, dbs, monkeypatch):
    dbs.add(EvalCase(question="vacaciones", last_ok=True))
    dbs.commit()
    passing = True
    monkeypatch.setattr(G.search, "retrieve", lambda *a, **k: [{"doc_id": 1}] if passing else [])
    current = datetime(2026, 10, 7)
    class Clock:
        @staticmethod
        def now():
            return current
    monkeypatch.setattr(G, "datetime", Clock)
    for _ in range(4):
        G.daily(dbs)
        dbs.commit()
        current += timedelta(days=1)
    medal = next(m for m in G.status(dbs)["medals"] if m["id"] == "sin_regresiones")
    assert medal["earned"] and medal["progress"] == 4
    passing = False
    G.daily(dbs)
    dbs.commit()
    assert S.raw(dbs, "growth_daily_streak") == "0"
    assert next(m for m in G.status(dbs)["medals"] if m["id"] == "sin_regresiones")["earned"]
