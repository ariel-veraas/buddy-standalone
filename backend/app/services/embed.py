"""Búsqueda por significado (opcional): vectores de los fragmentos y de la pregunta. Nunca rompe una consulta: si falla, queda el texto."""
import logging
import time

from sqlalchemy import func, select, update

from ..core import vectors as vec
from ..core.provider import ProviderError, default_embedding_dims, default_embedding_model, supports_embeddings
from ..models import Chunk, Collection
from . import settings as S

log = logging.getLogger("buddy.embed")
QUERY_TIMEOUT = 3.0
ANSWER_RESERVE = 20.0
INDEX_CALL_TIMEOUT = 30.0
SCAN_SECONDS = 2.5
BAD_INPUT_STATUS = {400, 413, 422}
_QUERIES = vec.QueryCache()
_BREAKER = vec.Breaker()


def semantic_cfg(db):
    """{model, dims, provider} si la búsqueda por significado está activa y el proveedor puede; si no, None."""
    if S.raw(db, "semantic_search") != "1":
        return None
    provider = S.raw(db, "provider")
    if not S.raw(db, "api_key") or not supports_embeddings(provider):
        return None
    model = S.raw(db, "embedding_model").strip() or default_embedding_model(provider)
    if not model:
        return None
    try:
        dims = int(S.raw(db, "embedding_dims") or 0)
    except ValueError:
        dims = 0
    if not vec.MIN_DIMS <= dims <= vec.MAX_DIMS:
        dims = default_embedding_dims(provider)
    return {"model": model, "dims": dims, "provider": provider, "api_base": S.raw(db, "api_base").strip()}


def _key(cfg):
    return (cfg["model"], cfg["dims"], cfg["provider"], cfg["api_base"])


def semantic_rows(db, provider, visible_ids, text, limit, cfg, deadline=None):
    """Los fragmentos más cercanos en significado a `text` entre los que ESTA persona puede leer (`visible_ids`).

    Devuelve (filas, info): filas = (similitud, chunk_id, document_id, sequence), mejor primero.
    """
    started = time.monotonic()

    def done(state, rows=()):
        return list(rows), {"state": state, "ms": int((time.monotonic() - started) * 1000)}

    if not visible_ids:
        return done("used")
    key = _key(cfg)
    cache_key = key + (vec.query_key(text),)
    vector = _QUERIES.get(cache_key)
    if vector is None:
        if not _BREAKER.allowed(key):
            return done("paused")
        timeout = QUERY_TIMEOUT
        if deadline is not None:
            timeout = min(timeout, deadline - time.monotonic() - ANSWER_RESERVE)
        if timeout < 0.5:
            return done("no_time")
        try:
            vector = provider._embed([text[:vec.QUERY_TEXT_CHARS]], cfg["model"], timeout, cfg["dims"])[0]
            _QUERIES.put(cache_key, vector)
            _BREAKER.success(key)
        except (ProviderError, TimeoutError, ValueError, OSError) as exc:
            if not (isinstance(exc, ProviderError) and exc.status in BAD_INPUT_STATUS):
                _BREAKER.failure(key)
            log.warning("La búsqueda por significado falló (%s)", getattr(exc, "code", type(exc).__name__))
            return done("failed")
        except Exception as exc:  # noqa: BLE001 - una mejora opcional no rompe la consulta
            log.warning("La búsqueda por significado falló (%s)", type(exc).__name__)
            return done("failed")
    dims = len(vector)
    capacity = vec.scan_capacity(dims)
    scan_until = time.monotonic() + SCAN_SECONDS
    if deadline is not None:
        scan_until = min(scan_until, deadline - ANSWER_RESERVE)
    scored = []
    try:
        base = (select(Chunk.id, Chunk.document_id, Chunk.sequence, Chunk.embedding)
                .where(Chunk.collection_id.in_(visible_ids), Chunk.embedding_model == cfg["model"],
                       Chunk.embedding.is_not(None)).order_by(Chunk.id))
        count = db.execute(select(func.count()).select_from(
            select(Chunk.id).where(Chunk.collection_id.in_(visible_ids), Chunk.embedding_model == cfg["model"],
                                   Chunk.embedding.is_not(None)).limit(capacity + 1).subquery())).scalar()
        if count > capacity:
            return done("too_big")
        step, last = 1500, 0
        while True:
            rows = db.execute(base.where(Chunk.id > last).limit(step)).all()
            if not rows:
                break
            last = rows[-1][0]
            scored.extend(vec.score_rows(vector, rows, dims))
            if len(rows) == step and time.monotonic() > scan_until:
                return done("no_time")
    except Exception as exc:  # noqa: BLE001
        log.warning("No pude leer los vectores (%s)", type(exc).__name__)
        return done("failed")
    return done("used", vec.select_semantic(scored, limit))


def pending_count(db, cfg):
    ids = [c.id for c in db.scalars(select(Collection).where(Collection.active.is_(True)))]
    if not ids:
        return 0
    return db.execute(select(func.count()).select_from(Chunk).where(
        Chunk.collection_id.in_(ids), (Chunk.embedding.is_(None)) | (Chunk.embedding_model != cfg["model"]))).scalar()


def index_pending(db, provider, cfg, budget=60.0):
    """Calcula los vectores que faltan, todo lo que alcance el tiempo. Se puede retomar: guarda tras cada pedido."""
    deadline = time.monotonic() + budget
    done = 0
    ids = [c.id for c in db.scalars(select(Collection).where(Collection.active.is_(True)))]
    while ids and time.monotonic() < deadline:
        rows = db.execute(select(Chunk.id, Chunk.context_text, Chunk.content).where(
            Chunk.collection_id.in_(ids), (Chunk.embedding.is_(None)) | (Chunk.embedding_model != cfg["model"]))
            .order_by(Chunk.id).limit(vec.BATCH_ITEMS * 4)).all()
        if not rows:
            break
        pairs = [(r[0], vec.embedding_text(r[1], r[2])) for r in rows]
        for group in vec.batches(pairs):
            try:
                vectors = provider._embed([t for _, t in group], cfg["model"],
                                          min(INDEX_CALL_TIMEOUT, max(deadline - time.monotonic(), 2.0)), cfg["dims"])
            except Exception as exc:  # noqa: BLE001
                log.warning("Indexado de vectores detenido (%s)", getattr(exc, "code", type(exc).__name__))
                return {"done": done, "state": "error:" + str(getattr(exc, "code", "provider_error"))}
            for (chunk_id, text_), vector in zip(group, vectors):
                db.execute(update(Chunk).where(Chunk.id == chunk_id).values(
                    embedding=vec.pack(vector), embedding_model=cfg["model"], embedding_hash=vec.text_hash(text_)))
                done += 1
            db.commit()
    return {"done": done, "state": "ok"}
