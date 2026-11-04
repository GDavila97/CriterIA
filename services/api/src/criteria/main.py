from importlib.metadata import version

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from criteria.config import Settings, load_settings
from criteria.observability import init_sentry


class Health(BaseModel):
    status: str
    version: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    init_sentry(settings)
    is_production = settings.app_env == "production"
    app = FastAPI(
        title="CriterIA API",
        version=version("criteria"),
        docs_url=None if is_production else "/docs",
        redoc_url=None,
        openapi_url=None if is_production else "/openapi.json",
    )

    @app.get("/healthz", response_model=Health)
    async def healthz() -> Health:
        return Health(status="ok", version=app.version)

    return app


def run() -> None:
    settings = load_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        proxy_headers=True,
        server_header=False,
    )
