"""Recuperación: qué fragmentos le llegan al modelo. Port del motor de Buddy v2 sobre PostgreSQL.

La pregunta se vuelve grupos de sinónimos; un fragmento coincide con un grupo si tiene alguna de sus palabras. Primero los
mejores, después los vecinos de cada uno mientras entre en el presupuesto de contexto. Todo se filtra por las colecciones
que ESTA persona puede leer, en SQL, antes de puntuar nada.
"""
import logging
import math
import threading
from collections import OrderedDict

from sqlalchemy import and_, or_, select, text as sql

from ..core import vectors as vec
from ..core.text import (all_synonyms, build_vocabulary, clean_title, combine_groups, content_words, context_groups,
                         correct_message, follow_up_kind, group_tsquery, has_topic, is_greeting, query_groups, unknown_words)
from ..models import Chunk, Collection, Document, Group
from . import embed

log = logging.getLogger("buddy.search")
TEXT_MIN_SCORE = 0.05
TEXT_RANK_WEIGHTS = "{0.05, 0.05, 0.1, 0.3}"
TEXT_MATCH_SHARE = 0.6
WEAK_SCORE = 0.12
VOCABULARY_DOCUMENTS = 1500
CONTENT_VOCABULARY_WORDS = 3000
CONTENT_VOCABULARY_CACHE = 16
MIN_SEMANTIC_CHARS = 6
MAX_CHUNKS_PER_DOCUMENT = 3
CANDIDATE_FACTOR = 4
CONTEXT_BUDGET = 7000
MAX_CHUNK_CHARS = 5000
_VOCABULARIES = OrderedDict()
_VOCABULARIES_LOCK = threading.Lock()


def visible_collection_ids(db, user):
    """Colecciones activas que la persona puede leer. Administradores y editores ven todas; el resto, las abiertas a
    todos o las de alguno de sus grupos (una colección «por grupos» sin grupos no la ve nadie más)."""
    query = select(Collection.id).where(Collection.active.is_(True))
    if user.role not in ("admin", "editor"):
        mine = [g.id for g in user.groups]
        shared = select(Collection.id).join(Collection.groups).where(Group.id.in_(mine)) if mine else None
        cond = Collection.visibility == "all"
        if shared is not None:
            cond = or_(cond, Collection.id.in_(shared))
        query = query.where(cond)
    return list(db.scalars(query))


def retrieve(db, user, message, cfg, provider=None, context=None, info=None):
    """Los fragmentos para responder `message`, ya ensamblados (lista de dicts)."""
    synonyms = all_synonyms(cfg.get("synonyms_raw") or "")
    groups = query_groups(message, synonyms)
    visible = visible_collection_ids(db, user)
    if not visible or not (groups or (context and context.get("questions"))):
        return []
    rows = _search_rows(db, groups, visible, cfg) if groups else []
    fully_matched = bool(rows) and rows[0][4] >= len(groups)
    if groups and (_weak(rows) or (not fully_matched and _has_unknown_word(db, message, visible, synonyms))):
        wider = _widened_groups(db, message, groups, visible, synonyms)
        if wider:
            more = _search_rows(db, wider, visible, cfg)
            if _quality(more, wider) > _quality(rows, groups):
                rows = more
    rows = _conversation_rows(db, message, groups, rows, visible, cfg, context, synonyms)
    semantic = embed.semantic_cfg(db) if cfg.get("semantic_on") and provider is not None else None
    if semantic and _worth_embedding(message, context):
        found, state = embed.semantic_rows(db, provider, visible, _semantic_text(message, context),
                                           min(cfg["top_k"] * CANDIDATE_FACTOR, 60), semantic, cfg.get("deadline"))
        if info is not None:
            info["semantic"] = state
        if found:
            rows = _fuse_rows(rows, found)
    best, per_document = [], {}
    for row in rows:
        if per_document.get(row[1], 0) >= MAX_CHUNKS_PER_DOCUMENT:
            continue
        per_document[row[1]] = per_document.get(row[1], 0) + 1
        best.append(row)
        if len(best) >= cfg["top_k"]:
            break
    return _assemble_context(db, best, visible)


def _search_rows(db, groups, visible, cfg, weights=None):
    """(id, document, sequence, puntaje, coincidencias) mejor primero, ya recortado a los que comparten lo suficiente."""
    queries = [group_tsquery(group) for group in groups]
    params = {"vis": list(visible), "all": " | ".join(queries), "minscore": float(cfg.get("text_min_score", TEXT_MIN_SCORE)),
              "limit": min(cfg["top_k"] * CANDIDATE_FACTOR, 60), "w": TEXT_RANK_WEIGHTS}
    parts = []
    for i, (text, query) in enumerate(zip(queries, queries)):
        params[f"q{i}"] = query
        weight = int(weights[i]) if weights else 1
        parts.append(f"{weight} * (c.fts @@ to_tsquery('spanish', :q{i}))::int")
    matched = " + ".join(parts)
    rank = "ts_rank_cd(CAST(:w AS float4[]), c.fts, q.query, 32)"
    query = sql(
        f"SELECT c.id, c.document_id, c.sequence, {rank} AS score, {matched} AS matched "
        "FROM chunks c, to_tsquery('spanish', :all) AS q(query) "
        f"WHERE c.collection_id = ANY(:vis) AND c.fts @@ q.query AND {rank} >= :minscore "
        "ORDER BY matched DESC, score DESC, c.id LIMIT :limit")
    try:
        rows = [tuple(r) for r in db.execute(query, params).all()]
    except Exception as exc:
        db.rollback()
        log.warning("Búsqueda de texto fallida (%s)", type(exc).__name__)
        raise
    if rows:
        needed = math.ceil(rows[0][4] * TEXT_MATCH_SHARE)
        rows = [row for row in rows if row[4] >= needed]
    return rows


def _weak(rows):
    return not rows or max(row[3] for row in rows) < WEAK_SCORE


def _quality(rows, groups):
    if not rows:
        return (0.0, 0.0)
    return (rows[0][4] / max(1, len(groups)), max(row[3] for row in rows))


def _content_vocabulary(db, visible):
    ids = tuple(sorted(visible))
    if not ids:
        return frozenset()
    try:
        count, newest = db.execute(sql("SELECT count(*), coalesce(max(id), 0) FROM chunks WHERE collection_id = ANY(:v)"),
                                   {"v": list(ids)}).one()
        key = (ids, count, newest)
        with _VOCABULARIES_LOCK:
            known = _VOCABULARIES.get(key)
            if known is not None:
                _VOCABULARIES.move_to_end(key)
                return known
        db.execute(sql("SET LOCAL statement_timeout = 2000"))  # consulta pesada: que nunca trabe la base
        rows = db.execute(sql(
            "SELECT w FROM (SELECT lower(w) AS w, count(*) AS n FROM chunks c, "
            "regexp_split_to_table(c.content, '[^[:alpha:]]+') AS w WHERE c.collection_id = ANY(:v) AND length(w) >= 4 "
            "GROUP BY 1 ORDER BY n DESC, 1 LIMIT :lim) t"), {"v": list(ids), "lim": CONTENT_VOCABULARY_WORDS * 2}).all()
        words = content_words((r[0] for r in rows), CONTENT_VOCABULARY_WORDS)
        db.execute(sql("RESET statement_timeout"))
    except Exception as exc:  # noqa: BLE001 - una consulta lenta no rompe la pregunta
        db.rollback()
        log.warning("No pude leer el vocabulario de los documentos (%s)", type(exc).__name__)
        return frozenset()
    with _VOCABULARIES_LOCK:
        _VOCABULARIES[key] = words
        while len(_VOCABULARIES) > CONTENT_VOCABULARY_CACHE:
            _VOCABULARIES.popitem(last=False)
    return words


def _has_unknown_word(db, message, visible, synonyms):
    if not unknown_words(message, ()):
        return False
    vocabulary = set(_content_vocabulary(db, visible))
    for group in synonyms or ():
        for member in group:
            vocabulary.update(member.split())
    return bool(unknown_words(message, vocabulary))


def _widened_groups(db, message, groups, visible, synonyms):
    docs = db.execute(select(Document.name, Document.path).where(
        Document.collection_id.in_(visible), Document.state == "ready").limit(VOCABULARY_DOCUMENTS)).all()
    texts = [clean_title(n) + " " + (p or "") for n, p in docs]
    texts += list(db.scalars(select(Collection.name).where(Collection.id.in_(visible))))
    vocabulary = build_vocabulary(texts, synonyms) | _content_vocabulary(db, visible)
    corrected, changed = correct_message(message, vocabulary)
    if not changed:
        return None
    wider = query_groups(corrected, synonyms)
    return wider if wider and wider != groups else None


def _conversation_rows(db, message, groups, rows, visible, cfg, context, synonyms):
    kind = follow_up_kind(message) if context and context.get("questions") else None
    if kind is None or (kind == "short" and not _weak(rows)):
        return rows
    questions = list(context["questions"])
    if len(questions) > 1 and follow_up_kind(questions[0]) is None:
        questions = questions[:1]
    combined, weights = combine_groups(groups, context_groups(questions, context.get("titles"), synonyms), dominant=kind == "short")
    if len(combined) == len(groups):
        return rows
    more = _search_rows(db, combined, visible, cfg, weights)
    if not more:
        return rows
    if kind == "dependent":
        return more
    return more if more[0][4] >= weights[0] and not _weak(more) else rows


def _worth_embedding(message, context):
    if is_greeting(message) or len(message.strip()) < MIN_SEMANTIC_CHARS:
        return False
    return has_topic(message) or bool(context and context.get("questions") and follow_up_kind(message) == "dependent")


def _semantic_text(message, context):
    if context and context.get("questions") and follow_up_kind(message) == "dependent":
        return (context["questions"][0] + "\n" + message)[:vec.QUERY_TEXT_CHARS]
    return message


def _fuse_rows(rows, semantic):
    merged = {row[0]: row for row in rows}
    for similarity, chunk_id, document_id, sequence in semantic:
        merged.setdefault(chunk_id, (chunk_id, document_id, sequence, max(0.0, min(0.99, float(similarity))), 0))
    order = vec.rrf([[row[0] for row in rows], [item[1] for item in semantic]])
    return [merged[chunk_id] for chunk_id, _score in order]


def _chunk_dict(chunk, document, collection_name, score, neighbor=False):
    return {"id": chunk.id, "doc_id": document.id, "title": document.name, "sequence": chunk.sequence,
            "owner": collection_name or "", "link": document.web_view_link or "", "updated": (document.modified_time or "")[:10],
            "text": chunk.content[:MAX_CHUNK_CHARS], "score": float(score), "neighbor": neighbor}


def _assemble_context(db, best, visible):
    """Los fragmentos elegidos dentro del presupuesto, más el anterior/siguiente de cada uno que todavía entre."""
    if not best:
        return []
    ids = [row[0] for row in best]
    loaded = {c.id: (c, d, name) for c, d, name in db.execute(
        select(Chunk, Document, Collection.name).join(Document, Document.id == Chunk.document_id)
        .join(Collection, Collection.id == Chunk.collection_id).where(Chunk.id.in_(ids), Chunk.collection_id.in_(visible))).all()}
    picked, used = [], 0
    for chunk_id, document_id, sequence, score, _matched in best:
        if chunk_id not in loaded:
            continue
        chunk, document, name = loaded[chunk_id]
        item = _chunk_dict(chunk, document, name, score)
        if picked and used + len(item["text"]) > CONTEXT_BUDGET:
            continue
        picked.append(item)
        used += len(item["text"])
    if not picked:
        return []
    have = {(i["doc_id"], i["sequence"]) for i in picked}
    wanted = {}
    for item in picked:
        for seq in (item["sequence"] + 1, item["sequence"] - 1):
            if seq >= 0 and (item["doc_id"], seq) not in have:
                wanted.setdefault(item["doc_id"], set()).add(seq)
    neighbours = {}
    if wanted:
        cond = or_(*[and_(Chunk.document_id == d, Chunk.sequence.in_(sorted(s))) for d, s in wanted.items()])
        for chunk, document, name in db.execute(
                select(Chunk, Document, Collection.name).join(Document, Document.id == Chunk.document_id)
                .join(Collection, Collection.id == Chunk.collection_id).where(cond, Chunk.collection_id.in_(visible))).all():
            neighbours[(document.id, chunk.sequence)] = (chunk, document, name)
    result = list(picked)
    for item in picked:
        for seq in (item["sequence"] + 1, item["sequence"] - 1):
            found = neighbours.get((item["doc_id"], seq))
            if not found or (item["doc_id"], seq) in have:
                continue
            extra = _chunk_dict(*found[:2], found[2], item["score"], neighbor=True)
            if used + len(extra["text"]) <= CONTEXT_BUDGET:
                have.add((item["doc_id"], seq))
                result.append(extra)
                used += len(extra["text"])
    order = {}
    for item in picked:
        order.setdefault(item["doc_id"], len(order))
    result.sort(key=lambda i: (order[i["doc_id"]], i["sequence"]))
    return result


def catalog(db, user):
    """Títulos y colecciones que esta persona puede leer, para saludos y «¿en qué me ayudás?»."""
    from ..core import prompts
    visible = visible_collection_ids(db, user)
    if not visible:
        return {"folders": [], "titles": [], "total": 0}
    names = list(db.scalars(select(Collection.name).where(Collection.id.in_(visible)).order_by(Collection.name)))
    from sqlalchemy import func
    total = db.scalar(select(func.count(Document.id)).where(Document.collection_id.in_(visible), Document.state == "ready"))
    titles = list(db.scalars(select(Document.name).where(Document.collection_id.in_(visible), Document.state == "ready")
                             .order_by(Document.collection_id, Document.path, Document.name).limit(prompts.CATALOG_MAX_TITLES)))
    return {"folders": [clean_title(n) for n in names][:prompts.CATALOG_MAX_FOLDERS],
            "titles": [clean_title(n) for n in titles], "total": total}
