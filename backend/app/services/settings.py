"""Ajustes del sistema guardados en la base. Los secretos (API key, clave de Drive) van cifrados y son write-only."""
import math

from sqlalchemy import select

from .. import security
from ..core import prompts
from ..core.provider import PROVIDERS, default_model
from ..models import Setting

SECRET_KEYS = {"api_key", "drive_key"}
DEFAULTS = {
    "provider": "gemini",
    "api_base": "",
    "chat_model": "",
    "top_k": "5",
    "buddy_name": "Buddy",
    "buddy_species": "mochi",
    "buddy_color": "",
    "buddy_tone": "calido",
    "default_wallpaper": "corazones",
    "company": "la empresa",
    "extra_instructions": "",
    "dialect": prompts.DEFAULT_DIALECT,
    "rate_per_minute": "6",
    "rate_per_day": "200",
    "max_daily_total": "5000",
    "max_concurrent": "8",
    "new_user_turns": "12",
    "semantic_search": "0",
    "embedding_model": "",
    "embedding_dims": "0",
    "synonyms": "",
    "sync_hours": "24",
    "store_questions": "0",
    "text_min_score": "0.05",
}
LIMITS = {"extra_instructions": 1500, "synonyms": 6000, "company": 160, "buddy_name": 80, "chat_model": 200,
          "api_base": 300, "embedding_model": 200}


SPECIES = ("mochi", "kitsu", "neko", "nube", "conejo", "osito")
COLORS = ("", "nieve", "rosa", "durazno", "manteca", "menta", "cielo", "lila", "cacao")
WALLPAPERS = ("liso", "corazones", "estrellas", "nubes", "flores", "patitas", "sakura", "lunas", "ondas", "puntitos", "garabatos")
TINTS = ("azul", "rosa", "menta", "durazno", "lila", "limon")
ACCESSORIES = ("", "bow", "hat", "glasses", "crown")
TONES = {
    "calido": "Personalidad: cálida y cercana. Podés cerrar con un emoji suave, máximo uno por respuesta.",
    "profesional": "Personalidad: profesional y sobria. No uses emojis.",
    "divertido": "Personalidad: simpática y juguetona, con un toque de humor liviano. Podés usar hasta dos emojis por respuesta, "
                 "sin perder precisión.",
}


class SettingsError(ValueError):
    pass


def get_all(db):
    """Todos los ajustes visibles (los secretos solo dicen si están cargados)."""
    values = dict(DEFAULTS)
    configured = set()
    for row in db.scalars(select(Setting)):
        if row.secret:
            if row.value:
                configured.add(row.key)
        else:
            values[row.key] = row.value
    values["api_key_set"] = "api_key" in configured
    values["drive_key_set"] = "drive_key" in configured
    return values


def raw(db, key, default=""):
    row = db.get(Setting, key)
    if row is None or row.value == "":
        return DEFAULTS.get(key, default)
    return security.decrypt(row.value) if row.secret else row.value


def set_many(db, updates: dict):
    for key, value in updates.items():
        if key not in DEFAULTS and key not in SECRET_KEYS:
            raise SettingsError(f"Ajuste desconocido: {key}")
        if value is None:
            continue
        value = str(value).strip() if key not in ("extra_instructions", "synonyms") else str(value).strip("\n ")
        if len(value) > LIMITS.get(key, 400) and key not in SECRET_KEYS:
            raise SettingsError(f"El ajuste «{key}» es demasiado largo.")
        _validate(key, value)
        if key in SECRET_KEYS and value == "":
            continue  # write-only: vacío = no cambiar
        row = db.get(Setting, key)
        stored = security.encrypt(value) if key in SECRET_KEYS else value
        if row is None:
            db.add(Setting(key=key, value=stored, secret=key in SECRET_KEYS))
        else:
            row.value, row.secret = stored, key in SECRET_KEYS


def clear_secret(db, key):
    if key not in SECRET_KEYS:
        raise SettingsError("No es un secreto.")
    row = db.get(Setting, key)
    if row:
        row.value = ""


def _validate(key, value):
    if key == "provider" and value not in PROVIDERS:
        raise SettingsError("Proveedor desconocido.")
    if key in ("top_k",) and not (value.isdigit() and 1 <= int(value) <= 10):
        raise SettingsError("«Fragmentos por consulta» tiene que estar entre 1 y 10.")
    if key in ("rate_per_minute", "rate_per_day", "max_daily_total", "max_concurrent", "new_user_turns", "sync_hours", "embedding_dims"):
        if not value.isdigit() or int(value) > 1_000_000:
            raise SettingsError(f"«{key}» tiene que ser un número entero.")
    if key in ("semantic_search", "store_questions") and value not in ("0", "1"):
        raise SettingsError("Valor inválido.")
    for name, allowed in (("buddy_species", SPECIES), ("buddy_color", COLORS), ("default_wallpaper", WALLPAPERS), ("buddy_tone", TONES)):
        if key == name and value not in allowed:
            raise SettingsError(f"Valor inválido para «{key}».")
    if key == "dialect" and value not in prompts.DIALECTS:
        raise SettingsError("Dialecto desconocido.")
    if key == "text_min_score":
        try:
            ok = math.isfinite(float(value)) and 0 <= float(value) < 1
        except ValueError:
            ok = False
        if not ok:
            raise SettingsError("Puntaje mínimo inválido.")


def provider_loader(db_factory):
    """Para BuddyProvider: lee la configuración del proveedor desde la base en cada llamada."""
    def load():
        with db_factory() as db:
            return {"provider": raw(db, "provider"), "api_key": raw(db, "api_key"), "api_base": raw(db, "api_base")}
    return load


def _with_tone(tone, extra):
    line = TONES.get(tone, TONES["calido"])
    return "\n".join(part for part in (line, extra) if part).strip()


def engine_cfg(db):
    """Configuración de una consulta de chat, validada. None en chat_model = sin configurar."""
    key = raw(db, "api_key")
    model = raw(db, "chat_model").strip()[:200] if key else ""
    if key and not model:
        model = default_model(raw(db, "provider"))
    cfg = {
        "chat_model": model, "top_k": int(raw(db, "top_k")), "rate_min": int(raw(db, "rate_per_minute")),
        "rate_day": int(raw(db, "rate_per_day")), "max_total": int(raw(db, "max_daily_total")),
        "max_concurrent": int(raw(db, "max_concurrent")), "new_turns": int(raw(db, "new_user_turns")),
        "buddy_name": raw(db, "buddy_name")[:80] or "Buddy", "company": raw(db, "company")[:160] or "la empresa",
        "extra_instructions": _with_tone(raw(db, "buddy_tone"), raw(db, "extra_instructions")[:1500]), "dialect": raw(db, "dialect"),
        "text_min_score": float(raw(db, "text_min_score")), "synonyms_raw": raw(db, "synonyms"),
        "store_questions": raw(db, "store_questions") == "1", "timeout": 35,
        "semantic_on": raw(db, "semantic_search") == "1",
        "species": raw(db, "buddy_species"), "color": raw(db, "buddy_color"), "wallpaper": raw(db, "default_wallpaper"),
    }
    if cfg["dialect"] not in prompts.DIALECTS:
        cfg["dialect"] = prompts.DEFAULT_DIALECT
    return cfg
