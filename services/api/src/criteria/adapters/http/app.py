from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from importlib.metadata import version

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from criteria.adapters.http.errors import install_error_handlers
from criteria.adapters.http.middleware import HardeningMiddleware, InternalErrorMiddleware
from criteria.adapters.http.routes import router
from criteria.adapters.http.services import ApiServices
from criteria.config import ApiSettings


def build_app(settings: ApiSettings, make_services: Callable[[], ApiServices]) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Built inside the serving loop: the database pools and the checkpointer bind to it.
        api_services = make_services()
        app.state.services = api_services
        await api_services.startup()
        try:
            yield
        finally:
            await api_services.shutdown()

    is_production = settings.app_env == "production"
    app = FastAPI(
        title="CriterIA API",
        version=version("criteria"),
        docs_url=None if is_production else "/docs",
        redoc_url=None,
        openapi_url=None if is_production else "/openapi.json",
        lifespan=lifespan,
    )
    install_error_handlers(app)
    app.include_router(router)
    # Added first, so it sits inside CORS and its 500 still carries the CORS headers.
    app.add_middleware(InternalErrorMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin_value],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["authorization", "content-type", "last-event-id"],
        max_age=600,
    )
    app.add_middleware(HardeningMiddleware, max_body_bytes=settings.max_request_bytes)
    return app
