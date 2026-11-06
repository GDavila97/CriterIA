import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from criteria.application.errors import ApplicationError
from criteria.ports.auth import AuthError
from criteria.ports.models import EndpointRejectedError, ProviderNotAllowedError
from criteria.ports.stores import LimitExceededError, StreamBusyError

logger = logging.getLogger(__name__)

# Fixed, user-facing messages: nothing from the request or from internals reaches a response.
MESSAGES: dict[str, str] = {
    "no_autenticado": "Falta un token válido.",
    "correo_no_verificado": "Verifica tu correo para usar esta función.",
    "no_encontrado": "No existe o no es tuyo.",
    "metodo_no_permitido": "Método no permitido.",
    "entrada_invalida": "La petición no cumple el formato esperado.",
    "estado_invalido": "La corrida no está en un estado que permita esta acción.",
    "stream_activo": "Ya hay un stream abierto para esta corrida.",
    "clave_requerida": "Ese proveedor necesita tu propia clave de API.",
    "proveedor_no_permitido": "Ese proveedor o modelo no está disponible.",
    "destino_no_permitido": "La URL del proveedor no está permitida.",
    "clave_invalida": "El proveedor rechazó la clave.",
    "clave_no_verificable": "No se pudo verificar la clave con el proveedor; intenta más tarde.",
    "limite_hora": "Alcanzaste el límite de corridas por hora.",
    "limite_dia": "Alcanzaste el límite de corridas por día.",
    "cupo_gratuito_agotado": "Se agotó el cupo gratuito de hoy; puedes usar tu propia clave.",
    "limite_validaciones": "Demasiadas validaciones de claves; intenta en una hora.",
    "cuerpo_demasiado_grande": "La petición es demasiado grande.",
    "error_interno": "Ocurrió un error interno.",
}

STATUS: dict[str, int] = {
    "no_autenticado": 401,
    "correo_no_verificado": 403,
    "no_encontrado": 404,
    "metodo_no_permitido": 405,
    "estado_invalido": 409,
    "stream_activo": 409,
    "cuerpo_demasiado_grande": 413,
    "limite_hora": 429,
    "limite_dia": 429,
    "cupo_gratuito_agotado": 429,
    "limite_validaciones": 429,
    "error_interno": 500,
}


def error_response(code: str) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if code == "no_autenticado" else None
    return JSONResponse(
        {"code": code, "message": MESSAGES.get(code, MESSAGES["error_interno"])},
        status_code=STATUS.get(code, 422),
        headers=headers,
    )


class ForbiddenError(Exception):
    def __init__(self, codigo: str) -> None:
        super().__init__(codigo)
        self.codigo = codigo


def install_error_handlers(app: FastAPI) -> None:
    async def validation(_request: Request, _error: Exception) -> JSONResponse:
        # Pydantic details would echo the submitted values, including keys.
        return error_response("entrada_invalida")

    async def application(_request: Request, error: Exception) -> JSONResponse:
        return error_response(getattr(error, "codigo", "error_interno"))

    async def auth(_request: Request, _error: Exception) -> JSONResponse:
        return error_response("no_autenticado")

    async def busy(_request: Request, _error: Exception) -> JSONResponse:
        return error_response("stream_activo")

    async def http(_request: Request, error: Exception) -> JSONResponse:
        status = getattr(error, "status_code", 500)
        code = {404: "no_encontrado", 405: "metodo_no_permitido"}.get(status, "entrada_invalida")
        return error_response(code)

    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        # Only the type: exception messages may carry row values or provider text.
        logger.error("unhandled error on %s: %s", request.url.path, type(error).__name__)
        return error_response("error_interno")

    app.add_exception_handler(RequestValidationError, validation)
    for kind in (
        ApplicationError,
        LimitExceededError,
        ProviderNotAllowedError,
        EndpointRejectedError,
        ForbiddenError,
    ):
        app.add_exception_handler(kind, application)
    app.add_exception_handler(AuthError, auth)
    app.add_exception_handler(StreamBusyError, busy)
    app.add_exception_handler(StarletteHTTPException, http)
    app.add_exception_handler(Exception, unexpected)
