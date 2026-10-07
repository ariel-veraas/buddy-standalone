import json
import uuid

import pytest
from sqlalchemy import select

from app import models, security
from app.models import Collection, Contact, Feedback, Message, Setting, Ticket, Usage, User
from app.services import chat, extract, ingest, settings as S

DOC = ("Política de vacaciones\n\nCada empleado tiene 14 días corridos de vacaciones por año. Para pedirlas hay que avisar "
       "con 15 días de anticipación a Recursos Humanos. " * 3)


class FakeProvider:
    """Responde con un JSON fijo, en pedacitos como lo haría un stream."""
    answer = {"answer": "Tenés 14 días corridos de vacaciones por año.", "expression": "happy", "needs_human": False,
              "sources_used": [1], "confidence": "high", "conflict": False}
    calls = 0
    boom = None

    def __init__(self, *a, **k):
        pass

    def _chat_stream(self, model, messages, timeout, **k):
        FakeProvider.calls += 1
        if FakeProvider.boom:
            raise FakeProvider.boom
        raw = json.dumps(FakeProvider.answer, ensure_ascii=False)
        usage = k.get("usage")
        if usage is not None:
            usage.update({"in": 120, "out": 30})
        for i in range(0, len(raw), 12):
            yield raw[i:i + 12]


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    FakeProvider.calls, FakeProvider.boom = 0, None
    FakeProvider.answer = {"answer": "Tenés 14 días corridos de vacaciones por año.", "expression": "happy", "needs_human": False,
                           "sources_used": [1], "confidence": "high", "conflict": False}
    monkeypatch.setattr(chat, "provider_for", lambda factory: FakeProvider())


@pytest.fixture()
def world(dbs):
    S.set_many(dbs, {"api_key": "sk-test", "provider": "openai", "chat_model": "m", "rate_per_minute": "50", "rate_per_day": "500"})
    c = Collection(name="Procedimientos", visibility="all")
    dbs.add(c)
    dbs.flush()
    ingest.add_upload(dbs, c, "vacaciones.txt", DOC.encode(), extract.extract_text)
    dbs.add(Contact(code="general", label="Recursos Humanos", name="Laura", email="laura@empresa.com"))
    user = User(email="ana@x.com", name="Ana", password_hash=security.hash_password("clave-larga-123"))
    other = User(email="beto@x.com", name="Beto", password_hash=security.hash_password("clave-larga-123"))
    dbs.add_all([user, other])
    dbs.commit()
    return user.id, other.id


def run(user_id, text, **kw):
    plan = chat.prepare(user_id, text, **kw)
    return list(chat.stream_events(plan))


def final(events):
    kinds = [k for k, _ in events]
    assert kinds[-1] in ("done", "error"), kinds
    return events[-1]


def test_answers_with_sources_and_streams_text(world):
    ana, _ = world
    events = run(ana, "¿cuántos días de vacaciones tengo?")
    kind, response = final(events)
    assert kind == "done", response
    assert any(k == "delta" for k, _ in events)
    assert "".join(p["text"] for k, p in events if k == "delta").startswith("Tenés 14 días")
    assert response["sources"][0]["title"] == "vacaciones.txt"
    assert response["feedback_token"] and response["ring"] == "ok"


def test_history_is_private_per_user(world, dbs):
    ana, beto = world
    run(ana, "días de vacaciones")
    with models.session() as db:
        assert len(chat.history(db, db.get(User, ana))["messages"]) == 2
        assert chat.history(db, db.get(User, beto))["messages"] == []


def test_idempotent_request_id_does_not_call_provider_twice(world):
    ana, _ = world
    rid = str(uuid.uuid4())
    first = final(run(ana, "días de vacaciones", request_id=rid))
    again = final(run(ana, "días de vacaciones", request_id=rid))
    assert first[0] == again[0] == "done" and FakeProvider.calls == 1


def test_per_minute_quota(world, dbs):
    ana, _ = world
    S.set_many(dbs, {"rate_per_minute": "2"})
    dbs.commit()
    run(ana, "días de vacaciones")
    run(ana, "días de vacaciones otra vez")
    with pytest.raises(chat.Busy) as err:
        chat.prepare(ana, "una más")
    assert err.value.code == "rate_limited"


def test_not_configured_without_api_key(world, dbs):
    ana, _ = world
    dbs.query(Setting).filter(Setting.key == "api_key").delete()
    dbs.commit()
    with pytest.raises(chat.Busy) as err:
        chat.prepare(ana, "hola")
    assert err.value.code == "not_configured"


def test_invalid_messages_are_refused(world):
    ana, _ = world
    for bad in ("", "   ", "x" * 2001, None, 42):
        with pytest.raises(chat.Busy) as err:
            chat.prepare(ana, bad)
        assert err.value.code == "invalid_message"
    with pytest.raises(chat.Busy):
        chat.prepare(ana, "hola", request_id="no-es-uuid")


def test_provider_failure_releases_and_stores_nothing(world):
    ana, _ = world
    FakeProvider.boom = RuntimeError("caído")
    kind, payload = final(run(ana, "días de vacaciones"))
    assert kind == "error" and payload["error"] == "provider_error"
    with models.session() as db:
        assert db.query(Message).filter(Message.user_id == ana).count() == 0
        assert db.query(Usage).one().state == "failed"
    FakeProvider.boom = None
    assert final(run(ana, "días de vacaciones"))[0] == "done"  # no quedó «ocupado»


def test_client_disconnect_releases_reservation(world):
    ana, _ = world
    plan = chat.prepare(ana, "días de vacaciones")
    gen = chat.stream_events(plan)
    next(gen)
    gen.close()
    with models.session() as db:
        assert db.query(Usage).one().state == "failed"
        assert db.query(Message).filter(Message.role == "assistant").count() == 0
    assert final(run(ana, "días de vacaciones"))[0] == "done"


def test_busy_while_another_question_is_in_flight(world):
    ana, _ = world
    chat.prepare(ana, "días de vacaciones")  # reservada y sin cerrar
    with pytest.raises(chat.Busy) as err:
        chat.prepare(ana, "otra cosa")
    assert err.value.code == "busy"


def test_global_capacity(world, dbs):
    ana, beto = world
    S.set_many(dbs, {"max_concurrent": "1"})
    dbs.commit()
    chat.prepare(ana, "días de vacaciones")
    with pytest.raises(chat.Busy) as err:
        chat.prepare(beto, "días de vacaciones")
    assert err.value.code == "busy"


def test_forget_starts_a_new_conversation_and_old_generation_is_rejected(world):
    ana, _ = world
    run(ana, "días de vacaciones")
    with models.session() as db:
        user = db.get(User, ana)
        old = chat.history(db, user)["session_generation"]
        new = chat.forget(db, user)
        db.commit()
        assert new == old + 1 and chat.history(db, user)["messages"] == []
    with pytest.raises(chat.Busy) as err:
        chat.prepare(ana, "hola", expected_generation=old)
    assert err.value.code == "session_changed"


def test_permission_change_discards_conversation(world):
    ana, _ = world
    run(ana, "días de vacaciones")
    with models.session() as db:
        db.get(User, ana).perm_version += 1
        db.commit()
    with models.session() as db:
        assert chat.history(db, db.get(User, ana))["messages"] == []


def test_answer_that_arrives_after_forget_is_discarded(world):
    ana, _ = world
    plan = chat.prepare(ana, "días de vacaciones")
    with models.session() as db:
        chat.forget(db, db.get(User, ana))
        db.commit()
    kind, payload = final(list(chat.stream_events(plan)))
    assert kind == "error" and payload["error"] == "session_changed"
    with models.session() as db:
        assert db.query(Message).filter(Message.user_id == ana).count() == 0


def test_human_needed_gives_contact_and_ticket_without_sources(world):
    ana, _ = world
    FakeProvider.answer = {"answer": "Eso no está documentado.", "expression": "doubt", "needs_human": True,
                           "contact_role": "general", "ticket": {"title": "Consulta sobre licencias", "description": "detalle"},
                           "confidence": "low"}
    kind, r = final(run(ana, "¿puedo tomar licencia por estudio?"))
    assert kind == "done" and r["sources"] == [] and r["ring"] == "doubt"
    assert r["contact"]["name"] == "Laura" and r["ticket"]["title"].startswith("Consulta")
    with models.session() as db:
        t1 = chat.create_ticket(db, db.get(User, ana), r["ticket"]["title"], "x", "clave-1")
        t2 = chat.create_ticket(db, db.get(User, ana), r["ticket"]["title"], "x", "clave-1")
        db.commit()
        assert t1 == t2 and db.query(Ticket).count() == 1


def test_feedback_is_anonymous_and_owner_only(world):
    ana, beto = world
    _, r = final(run(ana, "días de vacaciones"))
    token = r["feedback_token"]
    with models.session() as db:
        assert chat.vote(db, db.get(User, ana), token, "up") == {"vote": "up"}
        db.commit()
        row = db.query(Feedback).one()
        assert not hasattr(row, "user_id") and len(row.day) == 10
        assert token not in json.dumps([c.name for c in Feedback.__table__.columns])
        with pytest.raises(chat.Busy) as err:
            chat.vote(db, db.get(User, beto), token, "down")  # el token de otro no sirve
        assert err.value.code == "feedback_unknown"
        assert chat.vote(db, db.get(User, ana), token, "down", reason=None) == {"vote": "down"}
        db.commit()
        assert db.query(Feedback).count() == 1  # un solo voto por respuesta: cambiarlo lo reemplaza
        assert chat.vote(db, db.get(User, ana), token, "none") == {"vote": None}
        db.commit()
        assert db.query(Feedback).count() == 0


def test_feedback_validates_inputs(world):
    ana, _ = world
    with models.session() as db:
        for args in (("corto", "up"), ("x" * 20, "maybe"), ("x" * 20, "up", "razon-inventada")):
            with pytest.raises(chat.Busy) as err:
                chat.vote(db, db.get(User, ana), *args)
            assert err.value.code == "invalid_request"


def test_question_text_not_stored_in_insights_unless_unanswered(world):
    ana, _ = world
    run(ana, "días de vacaciones")
    with models.session() as db:
        assert db.query(models.Insight).one().question is None
