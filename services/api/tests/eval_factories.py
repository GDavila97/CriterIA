"""Small builders for evaluation batches, cases and results."""

from datetime import UTC, datetime
from uuid import UUID, uuid5

from criteria.domain.artifacts import CRITERIOS, Observacion, Puntaje
from criteria.domain.evaluation import (
    ROLES,
    AgentStats,
    ArtefactosCaso,
    CaseResult,
    Deteccion,
    DeteccionCaso,
    EvalBatch,
    EvalCase,
    ObservacionEnRonda,
    ProblemaSembrado,
)
from criteria.domain.events import ProveedorId

WHEN = datetime(2026, 11, 8, 12, tzinfo=UTC)
TEXT = "Un sistema de ejemplo para la evaluación. " * 6
TIPOS = ("ambiguedad", "inconsistencia", "faltante")


def case(case_id: str, problems: int | None = None) -> EvalCase:
    hard = case_id.startswith("dificil")
    count = (2 if hard else 0) if problems is None else problems
    return EvalCase(
        id=case_id,
        titulo=f"Caso {case_id}",
        dificultad=case_id.split("-", maxsplit=1)[0],  # type: ignore[arg-type]
        dominio="pruebas",
        texto=TEXT,
        problemas=[
            ProblemaSembrado(tipo=TIPOS[i % 3], descripcion=f"Problema sembrado número {i}")  # type: ignore[arg-type]
            for i in range(count)
        ],
    )


def all_cases() -> dict[str, EvalCase]:
    ids = [f"{d}-{n:02d}" for d in ("facil", "medio", "dificil") for n in range(1, 6)]
    return {i: case(i) for i in ids}


def observacion(texto: str = "Falta definir el plazo de entrega") -> Observacion:
    return Observacion(
        tipo="faltante",
        destino="analista",
        referencias=["HU-1"],
        descripcion=texto,
        sugerencia="Agregar el plazo",
    )


def result(  # noqa: PLR0913  one knob per field the tests vary
    case_id: str,
    *,
    estado: str = "completada",
    scores: tuple[int, int, int, int] | None = (4, 4, 3, 5),
    observaciones: int = 1,
    llamadas: int = 4,
    validas: int = 4,
    costo: float | None = 0.002,
    latencia_ms: int = 10_000,
    rondas: int = 1,
) -> CaseResult:
    agentes = {rol: AgentStats() for rol in ROLES}
    agentes["analista"] = AgentStats(llamadas=llamadas, validas_a_la_primera=validas)
    return CaseResult(
        case_id=case_id,
        estado=estado,  # type: ignore[arg-type]
        codigo_error=None if estado == "completada" else "salida_invalida",
        rondas=rondas,
        latencia_ms=latencia_ms,
        tokens_entrada=1000,
        tokens_salida=200,
        costo_usd=costo,
        agentes=agentes,
        artefactos=ArtefactosCaso(
            observaciones=[
                ObservacionEnRonda(ronda=0, observacion=observacion(f"Observación {i}"))
                for i in range(observaciones)
            ]
        ),
        puntajes=[]
        if scores is None
        else [
            Puntaje(criterio=c, valor=v, justificacion="Simulada")
            for c, v in zip(CRITERIOS, scores, strict=True)
        ],
        terminado_en=WHEN,
    )


def batch(
    provider: ProveedorId = "openai",
    model: str = "gpt-6-luna",
    results: list[CaseResult] | None = None,
    detections: dict[str, list[bool]] | None = None,
) -> EvalBatch:
    return EvalBatch(
        batch_id=uuid5(UUID(int=0), f"{provider}:{model}"),
        creado_en=WHEN,
        proveedor=provider,
        modelo=model,
        display_name=model,
        output_mode="tool",
        version_prompts="v1",
        juez_proveedor="anthropic",
        juez_modelo="claude-haiku-5-5",
        version_juez="v1",
        juez_mismo_proveedor=provider == "anthropic",
        git_sha="abc123",
        temperatura=0.2,
        temperatura_juez=0.0,
        max_tokens=8192,
        max_rondas=2,
        resultados={r.case_id: r for r in results or []},
        deteccion={
            case_id: DeteccionCaso(
                case_id=case_id,
                matcher_model="anthropic:claude-haiku-5-5",
                matcher_version="v1",
                detecciones=[
                    Deteccion(
                        problema=i,
                        detectado=found,
                        observacion=0 if found else None,
                        justificacion="Justificación del emparejador",
                    )
                    for i, found in enumerate(flags)
                ],
            )
            for case_id, flags in (detections or {}).items()
        },
    )


def full_batch(provider: ProveedorId, model: str) -> EvalBatch:
    return batch(provider, model, [result(cid) for cid in all_cases()])
