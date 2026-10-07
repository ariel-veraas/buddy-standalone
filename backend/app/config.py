"""Configuración por variables de entorno. Lo único obligatorio en producción es DATABASE_URL (el compose ya lo trae)."""
import os
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("BUDDY_DATA_DIR", "./data")).resolve()
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://buddy:buddy@localhost:5432/buddy")
COOKIE_SECURE = os.environ.get("BUDDY_COOKIE_SECURE", "auto")  # "1", "0" o "auto" (según el esquema de la petición)
SESSION_HOURS = int(os.environ.get("BUDDY_SESSION_HOURS", "12"))
MAX_UPLOAD_MB = int(os.environ.get("BUDDY_MAX_UPLOAD_MB", "25"))
# Si se define, el primer administrador solo se puede crear con este código (útil si el puerto queda expuesto antes de configurarlo).
SETUP_TOKEN = os.environ.get("BUDDY_SETUP_TOKEN", "")
STATIC_DIR = Path(os.environ.get("BUDDY_STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))


def secret_key() -> str:
    """SECRET_KEY de la variable de entorno, o una generada una sola vez y guardada en el volumen de datos."""
    env = os.environ.get("BUDDY_SECRET_KEY")
    if env:
        return env
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48))
        try:
            path.chmod(0o600)
        except OSError:
            pass
    return path.read_text().strip()
