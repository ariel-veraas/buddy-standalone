"""Texto plano de un archivo subido. Reusa los lectores endurecidos del cliente de Drive (límites de tamaño, XML sin DTD, PDF acotado)."""
from ..core import drive_client as dc


class Unsupported(Exception):
    pass


def extract_text(filename: str, data: bytes) -> tuple[str, bool]:
    """(texto, truncado). Lanza Unsupported si el tipo no se sabe leer; ValueError/DriveError si el archivo está dañado."""
    if len(data) > dc.MAX_DOWNLOAD_BYTES:
        raise ValueError("El archivo es demasiado grande.")
    name = (filename or "").lower()
    truncated = False
    if name.endswith(".pdf"):
        info = {}
        text = dc._pdf_to_text(data, info)
        truncated = bool(info.get("truncated"))
    elif name.endswith(".docx"):
        text = dc._docx_to_text(data)
    elif name.endswith(dc.HTML_EXTENSIONS):
        text = dc._html_to_text(dc._decode(data))
    elif name.endswith(dc.TEXT_EXTENSIONS):
        text = dc._decode(data)
    else:
        raise Unsupported("Tipo de archivo no compatible. Se leen PDF, Word (.docx), HTML, .txt, .md y .csv.")
    if text is None:
        raise ValueError("No pude leer el archivo.")
    text = text.lstrip("﻿")
    if len(text) > dc.MAX_OUTPUT_CHARS:
        text, truncated = text[:dc.MAX_OUTPUT_CHARS], True
    return text, truncated
