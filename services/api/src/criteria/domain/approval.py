from typing import Literal, Self

from pydantic import model_validator

from criteria.domain.artifacts import Esquema, Historias


class RespuestaHumana(Esquema):
    decision: Literal["aprobado", "editado"]
    historias: Historias | None = None

    @model_validator(mode="after")
    def _edits_carry_stories(self) -> Self:
        if self.decision == "editado" and self.historias is None:
            raise ValueError("an edit must include the edited stories")
        if self.decision == "aprobado" and self.historias is not None:
            raise ValueError("an approval must not include stories")
        return self
