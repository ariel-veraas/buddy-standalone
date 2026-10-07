import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, models
from .api import admin as admin_api, auth as auth_api, chat as chat_api, collections as collections_api, quality as quality_api, users as users_api
from .api import growth as growth_api
from .services import ingest

ROUTERS = [auth_api.router, users_api.router, admin_api.router, collections_api.router, chat_api.router, quality_api.router, growth_api.router]


def create_app(init=True) -> FastAPI:
    stop = threading.Event()

    @asynccontextmanager
    async def lifespan(app):
        if init:
            with models.session() as session:  # una sincronización que quedó a medias por un corte no queda «sincronizando» para siempre
                session.query(models.Collection).filter(models.Collection.state == "syncing").update({"state": "idle"})
                session.commit()
            threading.Thread(target=ingest.scheduler, args=(stop,), daemon=True).start()
        yield
        stop.set()

    app = FastAPI(title="Buddy", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    if init:
        db.init_db()
    for router in ROUTERS:
        app.include_router(router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Content-Security-Policy",
                                    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    static = config.STATIC_DIR
    if (static / "index.html").exists():
        if (static / "assets").exists():
            app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "No existe."}, status_code=404)
            candidate = (static / path).resolve()
            if path and static.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(static / "index.html")
    return app


def get_app() -> FastAPI:
    return create_app()
