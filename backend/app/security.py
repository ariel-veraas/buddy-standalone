"""Contraseñas (argon2id), cifrado de secretos en reposo (Fernet) y tokens de sesión/CSRF."""
import base64
import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from . import config

_hasher = PasswordHasher()
MIN_PASSWORD = 10


def password_problem(password: str) -> str | None:
    """Devuelve por qué la contraseña no sirve, o None."""
    if len(password) < MIN_PASSWORD:
        return f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres."
    if len(password) > 200:
        return "La contraseña es demasiado larga."
    if password.lower() in {"password123", "contraseña123", "1234567890", "qwertyuiop"}:
        return "Esa contraseña es demasiado común."
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


# Hash de relleno: login con email inexistente tarda lo mismo que con email real (no revela qué usuarios existen).
_DUMMY = _hasher.hash(secrets.token_urlsafe(16))


def verify_password(stored: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY, password) and stored is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored)
    except InvalidHashError:
        return False


def _fernet() -> Fernet:
    key = hashlib.sha256(("buddy-secrets:" + config.secret_key()).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Solo el hash de la sesión se guarda en la base: un volcado de la base no sirve para entrar."""
    return hmac.new(config.secret_key().encode(), token.encode(), hashlib.sha256).hexdigest()
