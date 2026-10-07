"""«Calidad»: qué falta documentar, la prueba de si Buddy encuentra las respuestas, y el panel de honestidad.

Todo se calcula con datos que ya existen (estadísticas de consultas, preguntas sin respuesta) y NO llama al proveedor de IA:
la prueba solo verifica la búsqueda, así que es gratis y se puede correr las veces que haga falta."""
from datetime import timedelta

from sqlalchemy import func, select

from ..core import digest_logic as D
from ..models import Document, EvalCase, EvalRun, GapState, Insight, Ticket, now
from . import search, settings as S

QUESTIONS_READ = D.QUESTIONS_READ
MAX_CASES = 200


def _key(term):
    pairs = D.question_keys(term, 1)
    return pairs[0][0] if pairs else ""


def honesty(db, days):
    """Cómo respondió Buddy en el período y en el anterior de igual largo: respondidas, con dudas, sin documentar."""
    def window(start, end):
        rows = dict(db.execute(select(Insight.outcome, func.count(Insight.id)).where(
            Insight.created_at >= start, Insight.created_at < end,
            Insight.outcome.in_(("answered", "unsure", "undocumented", "error"))).group_by(Insight.outcome)).all())
        total = sum(rows.values())
        return {"total": total, **{k: rows.get(k, 0) for k in ("answered", "unsure", "undocumented", "error")}}
    end = now()
    current = window(end - timedelta(days=days), end + timedelta(seconds=1))
    previous = window(end - timedelta(days=2 * days), end - timedelta(days=days))
    return {"days": days, "current": current, "previous": previous,
            "tickets_open": db.scalar(select(func.count(Ticket.id)).where(Ticket.state != "done"))}


def gaps(db, days):
    """Temas con preguntas sin respuesta, agrupados por palabras en común (sin IA), con su estado."""
    since = now() - timedelta(days=days)
    rows = db.execute(select(Insight.question, Insight.created_at).where(
        Insight.created_at >= since, Insight.question.is_not(None), Insight.outcome.in_(("undocumented", "unsure")))
        .order_by(Insight.created_at.desc()).limit(QUESTIONS_READ)).all()
    texts = [r[0] for r in rows]
    groups, ungrouped = D.cluster_questions(texts, max_groups=12)
    states = {s.key: s for s in db.scalars(select(GapState))}
    result = []
    for group in groups:
        key = _key(group["terms"][0])
        state = states.get(key)
        if state and state.state == "ignored":
            continue
        status, count = "open", group["count"]
        if state and state.state == "resolved":
            fresh = [rows[i][1] for i in group["members"] if rows[i][1] > state.changed_at]
            if not fresh:
                continue  # ya lo documentaron y nadie volvió a preguntarlo
            status, count = "returned", len(fresh)  # lo documentaron, pero la gente sigue preguntando
        examples = [texts[i] for i in sorted(group["members"], key=lambda i: (len(texts[i]), i))[:3]]
        result.append({"key": key, "terms": group["terms"], "count": count, "status": status,
                       "examples": [D.mask_personal(e) for e in examples], "raw_examples": examples,
                       "note": state.note if state else ""})
    return {"groups": result, "ungrouped": ungrouped, "read": len(texts)}


def set_gap(db, key, state, note=""):
    row = db.get(GapState, key)
    if row is None:
        db.add(GapState(key=key, state=state, note=note[:200]))
    else:
        row.state, row.note, row.changed_at = state, note[:200], now()


def config_label(cfg):
    return f"{cfg['chat_model'] or 'sin modelo'} · {'texto+significado' if cfg['semantic_on'] else 'texto'} · {cfg['top_k']} fragmentos"


def run_cases(db, user):
    """Corre todas las preguntas de la prueba contra la búsqueda actual. Sin llamar a la IA."""
    cfg = S.engine_cfg(db)
    cases = list(db.scalars(select(EvalCase).order_by(EvalCase.id)))
    results, passed, regressions = [], 0, 0
    for case in cases:
        try:
            chunks = search.retrieve(db, user, case.question, cfg)
        except Exception:  # noqa: BLE001  (una búsqueda rota no frena a las demás)
            db.rollback()
            chunks = []
        doc_ids = [c["doc_id"] for c in chunks]
        if case.document_id is not None:
            ok = case.document_id in doc_ids
            position = doc_ids.index(case.document_id) + 1 if ok else None
        else:
            ok, position = bool(chunks), (1 if chunks else None)
        if case.last_ok and not ok:
            regressions += 1
        passed += ok
        case.last_ok, case.last_checked = ok, now()
        results.append({"id": case.id, "ok": ok, "position": position, "found": len(chunks)})
    run = EvalRun(passed=passed, total=len(cases), config=config_label(cfg), regressions=regressions)
    db.add(run)
    return {"passed": passed, "total": len(cases), "regressions": regressions, "results": results, "config": run.config}


def cases_view(db):
    names = dict(db.execute(select(Document.id, Document.name)).all())
    return [{"id": c.id, "question": c.question, "document_id": c.document_id, "document": names.get(c.document_id, ""),
             "origin": c.origin, "last_ok": c.last_ok, "last_checked": c.last_checked.isoformat() if c.last_checked else None}
            for c in db.scalars(select(EvalCase).order_by(EvalCase.id.desc()))]


def history(db, limit=8):
    return [{"at": r.created_at.isoformat(), "passed": r.passed, "total": r.total, "config": r.config, "regressions": r.regressions}
            for r in db.scalars(select(EvalRun).order_by(EvalRun.id.desc()).limit(limit))]
