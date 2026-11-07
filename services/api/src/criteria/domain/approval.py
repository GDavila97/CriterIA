from typing import Literal, Self

from pydantic import model_validator

from criteria.domain.artifacts import Esquema, Historias
from criteria.domain.text import NotaUsuario

# How many times a person can send the stories back to the Analista in one run.
MAX_OTRAS_VERSIONES = 2

Decision = Literal["aprobado", "editado", "otra_version"]


class RespuestaHumana(Esquema):
    decision: Decision
    historias: Historias | None = None
    nota: NotaUsuario | None = None

    @model_validator(mode="after")
    def _payload_matches_decision(self) -> Self:
        if self.decision == "editado" and self.historias is None:
            raise ValueError("an edit must include the edited stories")
        if self.decision != "editado" and self.historias is not None:
            raise ValueError("only an edit includes stories")
        if self.decision != "otra_version" and self.nota is not None:
            raise ValueError("only a request for another version includes a note")
        return self
