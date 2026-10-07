from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import auth as A
from ..models import Document, EvalCase, User
from ..services import quality as Q

router = APIRouter(prefix="/api/quality")


@router.get("")
def overview(days: int = 30, ctx=Depends(A.staff), db=Depends(A.get_db)):
    days = max(1, min(days, 365))
    return {"honesty": Q.honesty(db, days), "gaps": Q.gaps(db, days), "cases": Q.cases_view(db), "history": Q.history(db)}


class GapIn(BaseModel):
    state: str = Field(pattern="^(resolved|ignored)$")
    document_id: int | None = None
    questions: list[str] = Field(default_factory=list, max_length=3)
    note: str = Field(default="", max_length=200)


@router.put("/gaps/{key}")
def update_gap(key: str, data: GapIn, request: Request, ctx=Depends(A.staff), db=Depends(A.get_db)):
    """Marca un tema como documentado (y, si se indica dónde, lo suma a la prueba) o lo ignora."""
    if not key or len(key) > 80:
        raise HTTPException(422, "Tema inválido.")
    if data.document_id is not None and db.get(Document, data.document_id) is None:
        raise HTTPException(422, "Ese documento no existe.")
    if data.state == "resolved" and data.document_id is not None:
        have = db.scalar(select(func.count(EvalCase.id)))
        for question in data.questions:
            question = question.strip()[:500]
            if question and have < Q.MAX_CASES:
                db.add(EvalCase(question=question, document_id=data.document_id, origin="gap"))
                have += 1
    Q.set_gap(db, key, data.state, data.note)
    A.audit(db, ctx.user, "gap_" + data.state, key, request)
    db.commit()
    return {"ok": True}


class CaseIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    document_id: int | None = None


@router.post("/cases")
def add_case(data: CaseIn, ctx=Depends(A.staff), db=Depends(A.get_db)):
    if data.document_id is not None and db.get(Document, data.document_id) is None:
        raise HTTPException(422, "Ese documento no existe.")
    if db.scalar(select(func.count(EvalCase.id))) >= Q.MAX_CASES:
        raise HTTPException(422, f"Máximo {Q.MAX_CASES} preguntas de prueba.")
    db.add(EvalCase(question=data.question.strip(), document_id=data.document_id))
    db.commit()
    return {"cases": Q.cases_view(db)}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, ctx=Depends(A.staff), db=Depends(A.get_db)):
    case = db.get(EvalCase, case_id)
    if case:
        db.delete(case)
        db.commit()
    return {"cases": Q.cases_view(db)}


@router.post("/run")
def run(ctx=Depends(A.staff), db=Depends(A.get_db)):
    """Verifica la búsqueda con todas las preguntas de prueba. No usa la IA: es gratis."""
    out = Q.run_cases(db, db.get(User, ctx.user.id))
    db.commit()
    return {**out, "cases": Q.cases_view(db), "history": Q.history(db)}


@router.get("/documents")
def documents(ctx=Depends(A.staff), db=Depends(A.get_db)):
    """Documentos entre los que elegir «dónde debería estar la respuesta»."""
    rows = db.scalars(select(Document).where(Document.state == "ready").order_by(Document.name).limit(1000))
    return [{"id": d.id, "name": d.name} for d in rows]
