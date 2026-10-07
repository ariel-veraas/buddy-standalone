"""Reglas puras del crecimiento compartido de Buddy."""
EVENT_XP = {"topic_verified": 15, "test_recovered": 10, "coverage_up": 25, "first_green_run": 20}


def level_for(xp):
    level, remaining = 1, max(0, xp)
    while level < 50 and remaining >= 40 + 20 * (level - 1):
        remaining -= 40 + 20 * (level - 1)
        level += 1
    return {"level": level, "xp_into_level": remaining, "xp_for_next": 0 if level == 50 else 40 + 20 * (level - 1)}


def stage_for(level):
    for ceiling, stage in ((2, "egg"), (6, "cria"), (14, "joven"), (29, "adulto")):
        if level <= ceiling:
            return stage
    return "legendario"


def week_key(dt):
    year, week, _ = dt.isocalendar()
    return f"{year}-W{week:02d}"


def coverage_gain(prev, cur):
    if prev["total"] < 10 or cur["total"] < 10:
        return False
    # Comparar enteros evita errores de redondeo justo en el umbral.
    return 100 * (cur["answered"] * prev["total"] - prev["answered"] * cur["total"]) >= 3 * prev["total"] * cur["total"]


def medals(stats):
    """Ocho hitos derivados de mejoras verificadas y corridas reales."""
    rules = [
        ("primer_paso", "Primer paso", "Verificar un tema", "verified_topics", 1),
        ("biblioteca", "Biblioteca", "Registrar diez temas", "registered_topics", 10),
        ("sin_regresiones", "Sin regresiones", "Cuatro días seguidos sin regresiones", "daily_streak", 4),
        ("nivel_5", "Nivel 5", "Llegar al nivel cinco", "level", 5),
        ("nivel_10", "Nivel 10", "Llegar al nivel diez", "level", 10),
        ("evolucion", "Evolución", "Llegar a joven", "level", 7),
        ("honesto", "Honesto", "Mejorar la cobertura tres veces", "coverage_up", 3),
        ("entrenado", "Entrenado", "Completar tres semanas de entrenamiento", "weekly_sessions", 3),
    ]
    return [{"id": ident, "name": name, "desc": desc, "earned": stats.get(key, 0) >= target,
             "progress": min(target, max(0, stats.get(key, 0))), "target": target}
            for ident, name, desc, key, target in rules]
