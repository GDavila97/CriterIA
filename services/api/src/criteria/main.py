import uvicorn
from fastapi import FastAPI

from criteria.adapters.http.app import build_app
from criteria.adapters.http.middleware import configure_logging
from criteria.bootstrap import ApiOverrides, build_api_services
from criteria.config import ApiSettings, load_api_settings
from criteria.observability import init_sentry


def create_app(
    settings: ApiSettings | None = None, overrides: ApiOverrides | None = None
) -> FastAPI:
    settings = settings or load_api_settings()
    configure_logging(settings.log_level)
    init_sentry(settings)
    return build_app(settings, lambda: build_api_services(settings, overrides))


def run() -> None:
    settings = load_api_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        access_log=False,
        proxy_headers=True,
        server_header=False,
    )
