import json

import pytest
from fastapi.testclient import TestClient

from app import auth as A
from app.main import create_app
from app.services import chat as chat_service
from tests.test_chat import FakeProvider

PASSWORD = "clave-larga-123"
DOC = ("Política de vacaciones\n\nCada empleado tiene 14 días corridos de vacaciones por año. Para pedirlas hay que avisar "
       "con 15 días de anticipación a Recursos Humanos. " * 3)


@pytest.fixture()
def app_client(dbs, monkeypatch):
    A.login_limiter.reset()
    A.login_account_limiter.reset()
    A.password_limiter.reset()
    FakeProvider.calls, FakeProvider.boom = 0, None
    monkeypatch.setattr(chat_service, "provider_for", lambda factory: FakeProvider())
    with TestClient(create_app(init=False), base_url="http://testserver") as c:
        yield c


class Api:
    def __init__(self, client):
        self.c, self.csrf = client, None

    def login(self, email, password=PASSWORD):
        self.c.cookies.clear()
        r = self.c.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf"]
        return r.json()

    def ready(self, email):
        """Entra y cambia la clave temporal (el sistema lo exige la primera vez)."""
        self.login(email)
        r = self.call("post", "/api/auth/password", json={"current": PASSWORD, "new": "nueva-clave-123"})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf"]

    def call(self, method, path, **kw):
        return getattr(self.c, method)(path, headers={"x-csrf-token": self.csrf or ""}, **kw)


@pytest.fixture()
def api(app_client):
    a = Api(app_client)
    r = app_client.post("/api/setup", json={"email": "admin@x.com", "name": "Ada", "password": PASSWORD})
    a.csrf = r.json()["csrf"]
    return a


def make_user(api, email, role="user", group_ids=()):
    r = api.call("post", "/api/admin/users", json={"email": email, "name": email, "role": role, "password": PASSWORD, "group_ids": list(group_ids)})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


def sse(response):
    events, kind = [], None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            kind = line[7:]
        elif line.startswith("data: "):
            events.append((kind, json.loads(line[6:])))
    return events


def configure(api):
    r = api.call("put", "/api/admin/settings", json={"api_key": "sk-test", "provider": "openai", "chat_model": "m",
                                                      "rate_per_minute": "50", "rate_per_day": "500"})
    assert r.status_code == 200, r.text
    assert "api_key" not in r.json() and r.json()["api_key_set"] is True


def test_full_flow_upload_then_ask(api):
    configure(api)
    group = api.call("post", "/api/admin/groups", json={"name": "Todos"}).json()["id"]
    col = api.call("post", "/api/collections", json={"name": "Procedimientos", "visibility": "groups", "group_ids": [group]}).json()["id"]
    up = api.call("post", f"/api/collections/{col}/upload", files=[("files", ("vacaciones.txt", DOC.encode(), "text/plain"))])
    assert up.status_code == 200 and up.json()["results"][0]["result"] == "updated"
    make_user(api, "ana@x.com", group_ids=[group])
    make_user(api, "pepe@x.com")  # sin grupo
    api.ready("ana@x.com")
    r = api.call("post", "/api/chat/stream", json={"message": "¿cuántos días de vacaciones tengo?"})
    events = sse(r)
    assert events[-1][0] == "done" and events[-1][1]["sources"][0]["title"] == "vacaciones.txt"
    h = api.call("get", "/api/chat/history").json()
    assert [m["role"] for m in h["messages"]] == ["user", "assistant"]


def test_user_without_group_gets_no_sources(api):
    configure(api)
    col = api.call("post", "/api/collections", json={"name": "Privada", "visibility": "groups"}).json()["id"]
    api.call("post", f"/api/collections/{col}/upload", files=[("files", ("vacaciones.txt", DOC.encode(), "text/plain"))])
    make_user(api, "pepe@x.com")
    api.ready("pepe@x.com")
    events = sse(api.call("post", "/api/chat/stream", json={"message": "días de vacaciones"}))
    # El modelo falso cita [1] aunque no haya fragmentos: el motor igual no inventa fuentes que el usuario no pueda leer.
    assert all("vacaciones.txt" not in json.dumps(p) for k, p in events if k == "done")


def test_roles_regular_user_cannot_manage(api):
    make_user(api, "ana@x.com")
    api.ready("ana@x.com")
    for method, path in (("get", "/api/collections"), ("get", "/api/admin/settings"), ("get", "/api/admin/users"),
                         ("get", "/api/admin/stats"), ("get", "/api/admin/audit"), ("get", "/api/admin/tickets")):
        assert api.call(method, path).status_code == 403, path
    assert api.call("post", "/api/collections", json={"name": "x"}).status_code == 403


def test_editor_manages_collections_but_not_settings_or_users(api):
    make_user(api, "edi@x.com", role="editor")
    api.ready("edi@x.com")
    assert api.call("post", "/api/collections", json={"name": "Nueva"}).status_code == 200
    assert api.call("get", "/api/admin/settings").status_code == 403
    assert api.call("get", "/api/admin/users").status_code == 403


def test_secrets_are_write_only_and_encrypted(api, dbs):
    configure(api)
    body = api.call("get", "/api/admin/settings").json()
    assert "sk-test" not in json.dumps(body)
    from app.models import Setting
    from sqlalchemy import select
    from app import models
    with models.session() as db:
        stored = db.get(Setting, "api_key").value
    assert stored != "sk-test" and "sk-test" not in stored
    # vacío = no cambiar
    api.call("put", "/api/admin/settings", json={"api_key": ""})
    assert api.call("get", "/api/admin/settings").json()["api_key_set"] is True
    api.call("delete", "/api/admin/settings/secret/api_key")
    assert api.call("get", "/api/admin/settings").json()["api_key_set"] is False


def test_settings_validation(api):
    for bad in ({"top_k": "99"}, {"provider": "inventado"}, {"semantic_search": "si"}, {"desconocido": "x"}):
        assert api.call("put", "/api/admin/settings", json=bad).status_code == 422, bad
    assert api.call("put", "/api/admin/settings", json={"drive_key": "{no es json}"}).status_code == 422


def test_upload_rejects_big_and_bad_files(api):
    col = api.call("post", "/api/collections", json={"name": "C", "visibility": "all"}).json()["id"]
    r = api.call("post", f"/api/collections/{col}/upload", files=[("files", ("raro.exe", b"MZ", "application/octet-stream")),
                                                                  ("files", ("ok.txt", b"hola mundo " * 40, "text/plain"))])
    results = {x["name"]: x["result"] for x in r.json()["results"]}
    assert results["raro.exe"] == "error" and results["ok.txt"] == "updated"


def test_drive_collection_needs_valid_folder_and_rejects_uploads(api):
    assert api.call("post", "/api/collections", json={"name": "D", "kind": "drive", "drive_folder": "no valido!"}).status_code == 422
    ok = api.call("post", "/api/collections", json={"name": "D", "kind": "drive", "drive_folder": "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"})
    assert ok.status_code == 200
    r = api.call("post", f"/api/collections/{ok.json()['id']}/upload", files=[("files", ("a.txt", b"x" * 100, "text/plain"))])
    assert r.status_code == 409


def test_deleting_collection_removes_documents_and_search(api):
    configure(api)
    col = api.call("post", "/api/collections", json={"name": "C", "visibility": "all"}).json()["id"]
    api.call("post", f"/api/collections/{col}/upload", files=[("files", ("vacaciones.txt", DOC.encode(), "text/plain"))])
    assert api.call("delete", f"/api/collections/{col}").status_code == 200
    assert api.call("get", "/api/collections").json() == []


def test_unauthenticated_cannot_reach_anything(app_client):
    for path in ("/api/chat/history", "/api/collections", "/api/admin/users", "/api/chat/config"):
        assert app_client.get(path).status_code == 401, path
    assert app_client.post("/api/chat/stream", json={"message": "hola"}).status_code in (401, 403)


def test_stats_and_tickets_endpoints(api):
    configure(api)
    s = api.call("get", "/api/admin/stats").json()
    assert s["total"] == 0 and s["feedback"] == {"up": 0, "down": 0}
    assert api.call("get", "/api/admin/tickets").json() == []


def test_editor_cannot_publish_or_connect_drive(api):
    make_user(api, "edi@x.com", role="editor")
    api.ready("edi@x.com")
    assert api.call("post", "/api/collections", json={"name": "A", "visibility": "all"}).status_code == 403
    assert api.call("post", "/api/collections", json={"name": "B", "kind": "drive", "drive_folder": "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"}).status_code == 403
    mine = api.call("post", "/api/collections", json={"name": "Mía"})
    assert mine.status_code == 200 and mine.json()["visibility"] == "groups" and mine.json()["groups"] == []
    cid = mine.json()["id"]
    assert api.call("patch", f"/api/collections/{cid}", json={"visibility": "all"}).status_code == 403
    assert api.call("patch", f"/api/collections/{cid}", json={"name": "Renombrada"}).status_code == 200
    assert api.call("post", f"/api/collections/{cid}/sync").status_code == 403


def test_upload_limits(api):
    cid = api.call("post", "/api/collections", json={"name": "C", "visibility": "all"}).json()["id"]
    many = [("files", (f"a{i}.txt", b"hola mundo " * 30, "text/plain")) for i in range(11)]
    assert api.call("post", f"/api/collections/{cid}/upload", files=many).status_code == 413


def test_setup_token_is_required_when_configured(app_client, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "SETUP_TOKEN", "codigo-secreto-123")
    status = app_client.get("/api/setup/status").json()
    assert (status["needs_setup"], status["needs_token"]) == (True, True)
    body = {"email": "a@x.com", "name": "A", "password": PASSWORD}
    assert app_client.post("/api/setup", json=body).status_code == 403
    assert app_client.post("/api/setup", json={**body, "setup_token": "otro"}).status_code == 403
    assert app_client.post("/api/setup", json={**body, "setup_token": "codigo-secreto-123"}).status_code == 200


def test_ticket_creation_is_capped(api, dbs):
    from app import models
    from app.services import chat as C
    from app.models import User
    with models.session() as db:
        user = db.query(User).first()
        for i in range(20):
            C.create_ticket(db, user, f"Consulta {i}", "x", None)
        with pytest.raises(C.Busy):
            C.create_ticket(db, user, "una más", "x", None)


def test_personality_settings_reach_chat_config_and_prompt(api, dbs):
    for bad in ({"buddy_species": "dragon"}, {"buddy_color": "negro"}, {"default_wallpaper": "x"}, {"buddy_tone": "furioso"}):
        assert api.call("put", "/api/admin/settings", json=bad).status_code == 422, bad
    ok = {"buddy_species": "kitsu", "buddy_color": "lila", "buddy_tone": "divertido", "default_wallpaper": "estrellas"}
    assert api.call("put", "/api/admin/settings", json=ok).status_code == 200
    cfg = api.call("get", "/api/chat/config").json()
    assert (cfg["species"], cfg["color"], cfg["default_wallpaper"]) == ("kitsu", "lila", "estrellas")
    from app.services import settings as S
    assert "juguetona" in S.engine_cfg(dbs)["extra_instructions"]


def test_prefs_are_validated_and_only_grow(api):
    assert api.call("get", "/api/chat/config").json()["prefs"]["tint"] == "azul"
    r = api.call("put", "/api/chat/prefs", json={"wallpaper": "sakura", "tint": "rosa", "asked": 7, "streak": 2, "last_day": "2026-10-07"})
    assert r.status_code == 200 and r.json()["prefs"]["wallpaper"] == "sakura"
    for bad in ({"wallpaper": "../x"}, {"tint": "negro"}, {"accessory": "capa"}, {"last_day": "ayer"}, {"asked": -1}):
        assert api.call("put", "/api/chat/prefs", json=bad).status_code in (400, 422), bad
    api.call("put", "/api/chat/prefs", json={"asked": 3})
    prefs = api.call("get", "/api/chat/config").json()["prefs"]
    assert prefs["asked"] == 7 and prefs["wallpaper"] == "sakura"  # el cariño no baja


def test_game_prefs_defaults_validation_and_personal_storage(api):
    initial = api.call("get", "/api/chat/config").json()["prefs"]
    assert initial["gba"] is False and initial["sound"] is False
    saved = api.call("put", "/api/chat/prefs", json={"gba": True, "sound": True}).json()["prefs"]
    assert saved["gba"] is True and saved["sound"] is True
    for key in ("gba", "sound"):
        for value in ("true", 1, [], {}):
            assert api.call("put", "/api/chat/prefs", json={key: value}).status_code == 422
    api.call("put", "/api/chat/prefs", json={"gba": False, "wallpaper": "sakura"})
    stored = api.call("get", "/api/chat/config").json()["prefs"]
    assert stored["gba"] is False and stored["sound"] is True and stored["wallpaper"] == "sakura"
    make_user(api, "otra@x.com")
    api.ready("otra@x.com")
    other = api.call("get", "/api/chat/config").json()["prefs"]
    assert other["gba"] is False and other["sound"] is False
