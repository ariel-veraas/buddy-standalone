import pytest
from fastapi.testclient import TestClient

from app import auth as A
from app.main import create_app

PASSWORD = "clave-larga-123"


@pytest.fixture()
def client(dbs):
    A.login_limiter.reset()
    A.login_account_limiter.reset()
    A.password_limiter.reset()
    with TestClient(create_app(init=False), base_url="http://testserver") as c:
        yield c


def post(client, path, body=None, csrf=None, method="post"):
    headers = {"x-csrf-token": csrf} if csrf else {}
    return getattr(client, method)(path, json=body, headers=headers)


def setup_admin(client):
    r = post(client, "/api/setup", {"email": "Admin@Empresa.com", "name": "Ada", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["csrf"]


def login(client, email, password=PASSWORD):
    client.cookies.clear()
    r = post(client, "/api/auth/login", {"email": email, "password": password})
    return r


def test_setup_runs_once_and_logs_in(client):
    status = client.get("/api/setup/status").json()
    assert (status["needs_setup"], status["needs_token"]) == (True, False) and status["brand"]["species"] == "mochi"
    csrf = setup_admin(client)
    assert client.get("/api/setup/status").json()["needs_setup"] is False
    assert client.get("/api/auth/me").json()["user"]["email"] == "admin@empresa.com"
    assert csrf
    again = post(client, "/api/setup", {"email": "otro@x.com", "name": "X", "password": PASSWORD})
    assert again.status_code == 409


def test_setup_rejects_weak_password_and_bad_email(client):
    assert post(client, "/api/setup", {"email": "a@b.com", "name": "A", "password": "corta"}).status_code == 422
    assert post(client, "/api/setup", {"email": "no-es-email", "name": "A", "password": PASSWORD}).status_code == 422


def test_cookie_flags_and_no_session_without_cookie(client):
    setup_admin(client)
    r = login(client, "admin@empresa.com")
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401


def test_login_errors_are_identical_and_generic(client):
    setup_admin(client)
    wrong = login(client, "admin@empresa.com", "incorrecta-123456")
    missing = login(client, "nadie@empresa.com", "incorrecta-123456")
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_brute_force_on_one_account_is_throttled_per_ip(client):
    setup_admin(client)
    for _ in range(8):
        login(client, "admin@empresa.com", "incorrecta-123456")
    assert login(client, "admin@empresa.com").status_code == 429  # desde esa IP, ni con la clave buena hasta que pase la ventana
    A.login_account_limiter.reset()
    assert login(client, "admin@empresa.com").status_code == 200  # la cuenta nunca queda bloqueada para siempre


def test_password_change_attempts_are_limited(client):
    csrf = setup_admin(client)
    codes = [post(client, "/api/auth/password", {"current": "mala-clave-12345", "new": "otra-clave-9999"}, csrf=csrf).status_code for _ in range(7)]
    assert codes[:5] == [403] * 5 and codes[5] == 429


def test_ip_rate_limit(client):
    setup_admin(client)
    codes = [login(client, f"x{i}@x.com", "incorrecta-123456").status_code for i in range(25)]
    assert 429 in codes


def test_csrf_required_on_writes(client):
    csrf = setup_admin(client)
    body = {"email": "ana@empresa.com", "name": "Ana", "role": "user"}
    assert post(client, "/api/admin/users", body).status_code == 403
    assert post(client, "/api/admin/users", body, csrf="falso").status_code == 403
    assert post(client, "/api/admin/users", body, csrf=csrf).status_code == 200


def test_foreign_origin_rejected(client):
    csrf = setup_admin(client)
    r = client.post("/api/admin/users", json={"email": "a@b.com", "name": "A"},
                    headers={"x-csrf-token": csrf, "origin": "http://evil.example"})
    assert r.status_code == 403


def make_user(client, csrf, email, role="user", password=PASSWORD):
    r = post(client, "/api/admin/users", {"email": email, "name": email.split("@")[0], "role": role, "password": password}, csrf=csrf)
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


def test_regular_user_cannot_use_admin_api(client):
    csrf = setup_admin(client)
    make_user(client, csrf, "ana@empresa.com")
    login(client, "ana@empresa.com")
    # debe cambiar la clave temporal primero; con la clave puesta por el admin sigue marcada como temporal
    me = client.get("/api/auth/me").json()
    assert client.get("/api/admin/users").status_code in (403,)
    assert me["user"]["role"] == "user"


def test_must_change_password_blocks_until_changed(client):
    csrf = setup_admin(client)
    make_user(client, csrf, "ana@empresa.com")
    r = login(client, "ana@empresa.com")
    csrf2 = r.json()["csrf"]
    assert r.json()["user"]["must_change_password"] is True
    changed = post(client, "/api/auth/password", {"current": PASSWORD, "new": "otra-clave-9999"}, csrf=csrf2)
    assert changed.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["must_change_password"] is False


def test_deactivating_user_kills_their_session(client):
    csrf = setup_admin(client)
    uid = make_user(client, csrf, "ana@empresa.com")
    admin_cookies = dict(client.cookies)
    login(client, "ana@empresa.com")
    ana_cookies = dict(client.cookies)
    client.cookies.clear()
    client.cookies.update(admin_cookies)
    assert post(client, f"/api/admin/users/{uid}", {"active": False}, csrf=csrf, method="patch").status_code == 200
    client.cookies.clear()
    client.cookies.update(ana_cookies)
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, "ana@empresa.com").status_code == 401


def test_cannot_remove_last_admin(client):
    csrf = setup_admin(client)
    me = client.get("/api/auth/me").json()["user"]["id"]
    assert post(client, f"/api/admin/users/{me}", {"role": "user"}, csrf=csrf, method="patch").status_code == 409
    assert post(client, f"/api/admin/users/{me}", {"active": False}, csrf=csrf, method="patch").status_code == 409
    assert client.delete(f"/api/admin/users/{me}", headers={"x-csrf-token": csrf}).status_code == 409


def test_reset_password_returns_temporary_once(client):
    csrf = setup_admin(client)
    uid = make_user(client, csrf, "ana@empresa.com")
    r = post(client, f"/api/admin/users/{uid}/reset-password", csrf=csrf)
    temp = r.json()["temporary_password"]
    assert login(client, "ana@empresa.com", temp).status_code == 200
    assert login(client, "ana@empresa.com").status_code == 401


def test_logout_invalidates_cookie(client):
    csrf = setup_admin(client)
    old = dict(client.cookies)
    assert post(client, "/api/auth/logout", csrf=csrf).status_code == 200
    client.cookies.clear()
    client.cookies.update(old)
    assert client.get("/api/auth/me").status_code == 401


def test_sessions_store_only_a_hash(client, dbs):
    from app import models
    setup_admin(client)
    token = client.cookies.get(A.COOKIE)
    with models.session() as check:
        stored = [s.token_hash for s in check.query(models.Session)]
    assert token not in stored and len(stored[0]) == 64


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
