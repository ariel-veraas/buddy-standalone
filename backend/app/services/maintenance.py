"""Limpieza periódica: sesiones vencidas, retención de datos y desvinculación de los votos."""
from datetime import timedelta

from sqlalchemy import delete, update

from ..models import AuditLog, Insight, Message, Session as DbSession, now

INSIGHT_DAYS = 180
AUDIT_DAYS = 365
MESSAGE_DAYS = 180
VOTE_CHANGE_MINUTES = 10
FEEDBACK_MAX_CHANGES = 6  # igual que chat.FEEDBACK_MAX_CHANGES: un voto desvinculado ya no se puede cambiar


def purge(db):
    """Devuelve cuántas filas se limpiaron por tipo."""
    current = now()
    out = {}
    out["sessions"] = db.execute(delete(DbSession).where(DbSession.expires_at <= current)).rowcount
    out["insights"] = db.execute(delete(Insight).where(Insight.created_at <= current - timedelta(days=INSIGHT_DAYS))).rowcount
    out["audit"] = db.execute(delete(AuditLog).where(AuditLog.created_at <= current - timedelta(days=AUDIT_DAYS))).rowcount
    out["messages"] = db.execute(delete(Message).where(Message.created_at <= current - timedelta(days=MESSAGE_DAYS))).rowcount
    # Pasada la ventana para cambiar el voto, se corta el vínculo entre la persona (su mensaje) y la fila anónima del voto.
    out["votes_unlinked"] = db.execute(
        update(Message).where(Message.feedback_id.is_not(None), Message.feedback_at <= current - timedelta(minutes=VOTE_CHANGE_MINUTES))
        .values(feedback_id=None, feedback_at=None, feedback_changes=FEEDBACK_MAX_CHANGES)).rowcount
    db.commit()
    return out
