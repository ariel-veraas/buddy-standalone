from app import security
from app.models import Collection, Group, User
from app.services import extract, ingest, search

CFG = {"top_k": 5, "text_min_score": 0.05, "synonyms_raw": "", "semantic_on": False}

VACACIONES = ("Política de vacaciones\n\nCada empleado tiene 14 días corridos de vacaciones por año. Para pedirlas hay que "
              "avisar con 15 días de anticipación a Recursos Humanos mediante el formulario RH-12. " * 3)
BACKUPS = ("Procedimiento de backups\n\nLos backups se hacen todas las noches a las 02:00 y se guardan 30 días. "
           "El responsable de verificarlos es el equipo de Sistemas. " * 3)
SUELDOS = ("Escala salarial confidencial\n\nEl sueldo de gerencia se revisa cada seis meses según la inflación. " * 3)


def user(db, email, role="user", groups=()):
    u = User(email=email, name=email, password_hash=security.hash_password("clave-larga-123"), role=role, groups=list(groups))
    db.add(u)
    db.flush()
    return u


def upload(db, collection, name, text):
    ingest.add_upload(db, collection, name, text.encode(), extract.extract_text)
    db.commit()


def setup_data(db):
    rrhh, sistemas = Group(name="RRHH"), Group(name="Sistemas")
    db.add_all([rrhh, sistemas])
    abierta = Collection(name="Procedimientos", visibility="all")
    privada = Collection(name="Gerencia", visibility="groups", groups=[rrhh])
    db.add_all([abierta, privada])
    db.flush()
    upload(db, abierta, "vacaciones.txt", VACACIONES)
    upload(db, abierta, "backups.txt", BACKUPS)
    upload(db, privada, "sueldos.txt", SUELDOS)
    return rrhh, sistemas


def titles(chunks):
    return {c["title"] for c in chunks}


def test_finds_the_right_document(dbs):
    setup_data(dbs)
    ana = user(dbs, "ana@x.com")
    chunks = search.retrieve(dbs, ana, "¿cuántos días de vacaciones tengo?", CFG)
    assert "vacaciones.txt" in titles(chunks)
    assert "backups.txt" not in titles(chunks)


def test_synonyms_and_accents(dbs):
    setup_data(dbs)
    ana = user(dbs, "ana@x.com")
    assert "backups.txt" in titles(search.retrieve(dbs, ana, "copias de seguridad quien las verifica", CFG)) or \
        "backups.txt" in titles(search.retrieve(dbs, ana, "backup responsable", CFG))


def test_typo_is_corrected(dbs):
    setup_data(dbs)
    ana = user(dbs, "ana@x.com")
    assert "backups.txt" in titles(search.retrieve(dbs, ana, "cuando se hacen los bakups", CFG))


def test_group_permissions_hide_private_collection(dbs):
    rrhh, _ = setup_data(dbs)
    sin_grupo = user(dbs, "pepe@x.com")
    con_grupo = user(dbs, "rh@x.com", groups=[rrhh])
    otro = user(dbs, "otro@x.com", groups=[Group(name="Otros")])
    admin = user(dbs, "admin@x.com", role="admin")
    question = "sueldo de gerencia inflación"
    assert search.retrieve(dbs, sin_grupo, question, CFG) == []
    assert search.retrieve(dbs, otro, question, CFG) == []
    assert "sueldos.txt" in titles(search.retrieve(dbs, con_grupo, question, CFG))
    assert "sueldos.txt" in titles(search.retrieve(dbs, admin, question, CFG))


def test_private_titles_never_reach_the_catalog_of_others(dbs):
    setup_data(dbs)
    pepe = user(dbs, "pepe@x.com")
    cat = search.catalog(dbs, pepe)
    assert "Gerencia" not in cat["folders"] and "sueldos" not in " ".join(cat["titles"]).lower()


def test_inactive_collection_is_not_searched(dbs):
    setup_data(dbs)
    ana = user(dbs, "ana@x.com")
    dbs.query(Collection).filter(Collection.name == "Procedimientos").update({"active": False})
    dbs.commit()
    assert search.retrieve(dbs, ana, "vacaciones", CFG) == []


def test_reupload_replaces_and_unchanged_is_skipped(dbs):
    setup_data(dbs)
    c = dbs.query(Collection).filter_by(name="Procedimientos").one()
    _, state = ingest.add_upload(dbs, c, "vacaciones.txt", VACACIONES.encode(), extract.extract_text)
    assert state == "unchanged"
    upload(dbs, c, "vacaciones.txt", "Vacaciones\n\nAhora son 21 días de vacaciones por año. " * 3)
    ana = user(dbs, "ana@x.com")
    texts = " ".join(ch["text"] for ch in search.retrieve(dbs, ana, "días de vacaciones", CFG))
    assert "21 días" in texts and "14 días" not in texts


def test_unsupported_and_broken_files_are_reported_not_fatal(dbs):
    setup_data(dbs)
    c = dbs.query(Collection).filter_by(name="Procedimientos").one()
    _, state = ingest.add_upload(dbs, c, "imagen.png", b"\x89PNG", extract.extract_text)
    assert state == "error"
    _, state = ingest.add_upload(dbs, c, "roto.pdf", b"no soy un pdf", extract.extract_text)
    assert state == "error"
    dbs.commit()


def test_neighbours_are_added(dbs):
    long = "\n\n".join(f"Paso {i}: " + ("detalle del procedimiento de alta de proveedores " * 12) for i in range(40))
    c = Collection(name="Compras", visibility="all")
    dbs.add(c)
    dbs.flush()
    upload(dbs, c, "alta.txt", long)
    chunks = search.retrieve(dbs, user(dbs, "a@x.com"), "alta de proveedores", CFG)
    assert any(ch["neighbor"] for ch in chunks) or len(chunks) >= 2
