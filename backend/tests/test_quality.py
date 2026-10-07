import time

from app.models import Insight
from tests.test_api_flow import DOC, api, app_client, configure, make_user  # noqa: F401  (fixtures)

QUESTIONS = ["¿cómo pido vacaciones?", "¿cuántos días de vacaciones me tocan?", "vacaciones: ¿a quién aviso?",
             "¿cuándo cobro el aguinaldo?", "¿cómo se calcula el aguinaldo?"]


def seed_unanswered(dbs):
    for text in QUESTIONS:
        dbs.add(Insight(question=text, outcome="undocumented"))
    dbs.add(Insight(question=None, outcome="answered"))
    dbs.commit()


def upload(api):
    col = api.call("post", "/api/collections", json={"name": "RRHH", "visibility": "all"}).json()["id"]
    up = api.call("post", f"/api/collections/{col}/upload", files=[("files", ("vacaciones.txt", DOC.encode(), "text/plain"))])
    assert up.status_code == 200
    return api.call("get", "/api/quality/documents").json()[0]["id"]


def test_gaps_are_grouped_and_honesty_counts(api, dbs):
    seed_unanswered(dbs)
    data = api.call("get", "/api/quality").json()
    groups = {g["terms"][0].lower(): g for g in data["gaps"]["groups"]}
    assert groups["vacaciones"]["count"] == 3 and groups["vacaciones"]["status"] == "open"
    assert data["honesty"]["current"]["undocumented"] == 5 and data["honesty"]["current"]["answered"] == 1


def test_resolving_a_gap_creates_cases_and_the_run_verifies_them(api, dbs):
    configure(api)
    seed_unanswered(dbs)
    doc = upload(api)
    gap = next(g for g in api.call("get", "/api/quality").json()["gaps"]["groups"] if g["terms"][0].lower() == "vacaciones")
    r = api.call("put", f"/api/quality/gaps/{gap['key']}", json={"state": "resolved", "document_id": doc, "questions": gap["raw_examples"]})
    assert r.status_code == 200
    data = api.call("get", "/api/quality").json()
    assert all(g["terms"][0].lower() != "vacaciones" for g in data["gaps"]["groups"])  # ya no figura como pendiente
    assert len(data["cases"]) == 3
    run = api.call("post", "/api/quality/run").json()
    assert run["total"] == 3 and run["passed"] == 3 and run["regressions"] == 0
    assert run["history"][0]["passed"] == 3


def test_a_documented_topic_returns_when_people_keep_asking(api, dbs):
    seed_unanswered(dbs)
    key = next(g["key"] for g in api.call("get", "/api/quality").json()["gaps"]["groups"] if g["terms"][0].lower() == "vacaciones")
    time.sleep(0.05)  # el reloj de Windows avanza de a ~15 ms
    api.call("put", f"/api/quality/gaps/{key}", json={"state": "resolved"})
    time.sleep(0.05)
    for text in ("¿vacaciones en enero?", "¿vacaciones para mi hijo?"):
        dbs.add(Insight(question=text, outcome="undocumented"))
    dbs.commit()
    groups = api.call("get", "/api/quality").json()["gaps"]["groups"]
    back = next(g for g in groups if g["terms"][0].lower() == "vacaciones")
    assert back["status"] == "returned" and back["count"] == 2


def test_manual_cases_validation_limits_and_permissions(api, dbs):
    doc = upload(api)
    assert api.call("post", "/api/quality/cases", json={"question": "¿días de vacaciones?", "document_id": doc}).status_code == 200
    assert api.call("post", "/api/quality/cases", json={"question": "x"}).status_code == 422
    assert api.call("post", "/api/quality/cases", json={"question": "¿algo?", "document_id": 99999}).status_code == 422
    assert api.call("put", "/api/quality/gaps/tema", json={"state": "borrar"}).status_code == 422
    case = api.call("get", "/api/quality").json()["cases"][0]
    # una pregunta que ningún documento responde no pasa
    api.call("post", "/api/quality/cases", json={"question": "¿qué hora es en Marte?"})
    run = api.call("post", "/api/quality/run").json()
    assert run["total"] == 2 and run["passed"] == 1
    assert api.call("delete", f"/api/quality/cases/{case['id']}").status_code == 200
    make_user(api, "ana@x.com")
    api.ready("ana@x.com")
    assert api.call("get", "/api/quality").status_code == 403
    assert api.call("post", "/api/quality/run").status_code == 403
