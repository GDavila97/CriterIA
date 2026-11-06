class ApplicationError(Exception):
    """A failure the client may see; `codigo` is stable and the message never carries input."""

    codigo = "error"

    def __init__(self, message: str, codigo: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if codigo is not None:
            self.codigo = codigo


class NotFoundError(ApplicationError):
    codigo = "no_encontrado"


class ConflictError(ApplicationError):
    codigo = "estado_invalido"


class InvalidInputError(ApplicationError):
    codigo = "entrada_invalida"


class CredentialRejectedError(ApplicationError):
    codigo = "clave_invalida"
