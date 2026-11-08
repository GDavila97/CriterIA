"""Publishes evaluation batches with the eval_writer role, which can only insert.

Every row has an id derived from the batch and the case, and inserts skip rows that already exist,
so a batch or a scoring session can be published again without duplicates.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from criteria.adapters.postgres import database as t
from criteria.domain.evaluation import (
    CaseResult,
    EvalBatch,
    EvalCase,
    HumanSession,
    case_uuid,
    row_uuid,
)


@dataclass(frozen=True)
class Published:
    cases: int
    batches: int
    results: int
    human_scores: int = 0


async def _insert(conn: AsyncConnection, table: sa.Table, rows: Sequence[dict[str, Any]]) -> int:
    """One statement per row so each reports whether it was new; a batch has at most 15.

    No conflict target: naming one would need SELECT, and eval_writer may only insert.
    """
    inserted = 0
    for row in rows:
        result = await conn.execute(
            insert(table).values(row).on_conflict_do_nothing(),
            execution_options={"preserve_rowcount": True},
        )
        inserted += int(result.rowcount)
    return inserted


def _case_row(case: EvalCase) -> dict[str, Any]:
    return {
        "id": case_uuid(case.id),
        "title": case.titulo,
        "text": case.texto,
        "difficulty": case.dificultad,
        "tags": [case.id],
        "domain": case.dominio,
        "seeded_problems": [p.model_dump(mode="json") for p in case.problemas],
    }


def _batch_row(batch: EvalBatch) -> dict[str, Any]:
    return {
        "id": batch.batch_id,
        "created_at": batch.creado_en,
        "provider": batch.proveedor,
        "model": batch.modelo,
        "prompt_version": batch.version_prompts,
        "judge_model": batch.etiqueta_juez,
        "judge_version": batch.version_juez,
        "output_mode": batch.output_mode,
        "git_sha": batch.git_sha,
        "notes": "Aprobación humana automática sin cambios.",
        "display_name": batch.display_name,
        "temperature": batch.temperatura,
        "judge_same_provider": batch.juez_mismo_proveedor,
        "settings": {
            "temperatura_juez": batch.temperatura_juez,
            "max_tokens": batch.max_tokens,
            "max_rondas": batch.max_rondas,
            "aprobacion": batch.aprobacion,
            "costo_gastado_usd": batch.costo_gastado_usd,
            "ollama": None if batch.ollama is None else batch.ollama.model_dump(mode="json"),
        },
    }


def _result_row(batch: EvalBatch, result: CaseResult) -> dict[str, Any]:
    validas, llamadas = result.validas_a_la_primera
    deteccion = batch.deteccion.get(result.case_id)
    return {
        "id": row_uuid(batch.batch_id, "result", result.case_id),
        "batch_id": batch.batch_id,
        "case_id": case_uuid(result.case_id),
        "artifacts": result.artefactos.model_dump(mode="json"),
        "valid_output": result.estado == "completada" and validas == llamadas,
        "review_rounds": result.rondas,
        "latency_ms": result.latencia_ms,
        "tokens_in": result.tokens_entrada,
        "tokens_out": result.tokens_salida,
        "cost_usd": result.costo_usd,
        "scores": [p.model_dump(mode="json") for p in result.puntajes],
        "completed": result.estado == "completada",
        "error_code": result.codigo_error,
        "details": {
            "llamadas": llamadas,
            "validas_a_la_primera": validas,
            "intentos": result.intentos,
            "agentes": {r: s.model_dump(mode="json") for r, s in result.agentes.items()},
            "deteccion": None if deteccion is None else deteccion.model_dump(mode="json"),
        },
    }


class PostgresEvalPublisher:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def publish(self, batch: EvalBatch, cases: Mapping[str, EvalCase]) -> Published:
        used = [cases[case_id] for case_id in sorted(batch.resultados)]
        async with self._engine.begin() as conn:
            return Published(
                cases=await _insert(conn, t.eval_case, [_case_row(c) for c in used]),
                batches=await _insert(conn, t.eval_batch, [_batch_row(batch)]),
                results=await _insert(
                    conn,
                    t.eval_result,
                    [_result_row(batch, r) for _, r in sorted(batch.resultados.items())],
                ),
            )

    async def publish_human(self, session: HumanSession) -> int:
        rows = [
            {
                "id": row_uuid(s.batch_id, "human", s.case_id, s.criterio),
                "batch_id": s.batch_id,
                "case_id": case_uuid(s.case_id),
                "criterion": s.criterio,
                "score": s.valor,
            }
            for s in session.puntajes
        ]
        async with self._engine.begin() as conn:
            return await _insert(conn, t.human_score, rows)
