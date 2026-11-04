from collections import Counter
from collections.abc import Iterable
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from criteria.domain.text import (
    Justificacion,
    TextoCorto,
    TextoLargo,
    TextoMedio,
    TextoRequerimiento,
)

MAX_HISTORIAS = 12
MAX_CRITERIOS = 60
MAX_CASOS = 60
MAX_OBSERVACIONES = 10

HistoriaId = Annotated[str, StringConstraints(pattern=r"^HU-[1-9]\d?$")]
CriterioId = Annotated[str, StringConstraints(pattern=r"^CA-[1-9]\d{0,2}$")]
CasoId = Annotated[str, StringConstraints(pattern=r"^CP-\d{2}$")]
ArtefactoId = Annotated[str, StringConstraints(pattern=r"^(HU-[1-9]\d?|CA-[1-9]\d{0,2}|CP-\d{2})$")]

Prioridad = Literal["alta", "media", "baja"]
OrigenCaso = Literal["qa", "revisor"]
TipoObservacion = Literal["ambiguedad", "inconsistencia", "faltante"]
DestinoObservacion = Literal["analista", "qa"]
Criterio = Literal["claridad", "verificabilidad", "completitud", "consistencia"]
CRITERIOS: tuple[Criterio, ...] = ("claridad", "verificabilidad", "completitud", "consistencia")


class Esquema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _duplicates(values: Iterable[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def _require_unique(values: Iterable[str], what: str) -> None:
    repeated = _duplicates(values)
    if repeated:
        raise ValueError(f"duplicated {what}: {', '.join(repeated)}")


class Requerimiento(Esquema):
    texto: TextoRequerimiento


class HistoriaUsuario(Esquema):
    id: HistoriaId
    como: TextoMedio
    quiero: TextoMedio
    para: TextoMedio
    prioridad: Prioridad
    supuestos: list[TextoMedio] = Field(default_factory=list, max_length=8)


class CriterioAceptacion(Esquema):
    id: CriterioId
    historia_id: HistoriaId
    texto: TextoLargo


class EscenarioGherkin(Esquema):
    escenario: TextoCorto
    dado: list[TextoMedio] = Field(min_length=1, max_length=6)
    cuando: list[TextoMedio] = Field(min_length=1, max_length=6)
    entonces: list[TextoMedio] = Field(min_length=1, max_length=6)


class CasoPrueba(Esquema):
    id: CasoId
    historia_id: HistoriaId
    titulo: TextoCorto
    pasos: list[TextoMedio] = Field(min_length=1, max_length=12)
    resultado_esperado: TextoMedio
    gherkin: EscenarioGherkin
    origen: OrigenCaso = "qa"


class Observacion(Esquema):
    tipo: TipoObservacion
    destino: DestinoObservacion
    referencias: list[ArtefactoId] = Field(default_factory=list, max_length=10)
    descripcion: TextoLargo
    sugerencia: TextoLargo


class VeredictoRevisor(Esquema):
    aprobado: bool
    observaciones: list[Observacion] = Field(default_factory=list, max_length=MAX_OBSERVACIONES)

    @model_validator(mode="after")
    def _approval_matches_observations(self) -> Self:
        if self.aprobado and self.observaciones:
            raise ValueError("an approved verdict cannot carry observations")
        if not self.aprobado and not self.observaciones:
            raise ValueError("a rejected verdict needs at least one observation")
        return self


class Puntaje(Esquema):
    criterio: Criterio
    valor: int = Field(ge=1, le=5)
    justificacion: Justificacion


class Historias(Esquema):
    historias: list[HistoriaUsuario] = Field(min_length=1, max_length=MAX_HISTORIAS)

    @model_validator(mode="after")
    def _unique_ids(self) -> Self:
        _require_unique((historia.id for historia in self.historias), "story ids")
        return self

    def ids(self) -> set[str]:
        return {historia.id for historia in self.historias}


class EntregaQA(Esquema):
    criterios: list[CriterioAceptacion] = Field(min_length=1, max_length=MAX_CRITERIOS)
    casos: list[CasoPrueba] = Field(min_length=1, max_length=MAX_CASOS)

    @model_validator(mode="after")
    def _unique_ids(self) -> Self:
        _require_unique((criterio.id for criterio in self.criterios), "criterion ids")
        _require_unique((caso.id for caso in self.casos), "test case ids")
        return self

    def historias_referidas(self) -> set[str]:
        return {c.historia_id for c in self.criterios} | {c.historia_id for c in self.casos}

    def ids(self) -> set[str]:
        return {c.id for c in self.criterios} | {c.id for c in self.casos}


class Evaluacion(Esquema):
    puntajes: list[Puntaje] = Field(min_length=len(CRITERIOS), max_length=len(CRITERIOS))

    @model_validator(mode="after")
    def _one_score_per_criterion(self) -> Self:
        _require_unique((puntaje.criterio for puntaje in self.puntajes), "criteria")
        return self
