from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from criteria.domain.events import (
    AgenteInicia,
    AgenteProgreso,
    CorridaFin,
    Uso,
    evento_adapter,
    sumar_totales,
)

ENVELOPE = {"run_id": str(uuid4()), "seq": 1, "ts": "2026-11-05T12:00:00Z", "agent": "qa"}


def test_parses_events_by_their_type_discriminator() -> None:
    event = evento_adapter.validate_python({**ENVELOPE, "type": "agente_inicia", "ronda": 1})

    assert isinstance(event, AgenteInicia)


def test_rejects_unknown_event_types() -> None:
    with pytest.raises(ValidationError):
        evento_adapter.validate_python({**ENVELOPE, "type": "agente_duerme"})


def test_every_event_carries_run_id_seq_ts_and_agent() -> None:
    for missing in ("run_id", "seq", "ts", "agent"):
        data = {**ENVELOPE, "type": "agente_inicia", "ronda": 0}
        del data[missing]
        with pytest.raises(ValidationError):
            evento_adapter.validate_python(data)


def test_seq_starts_at_one_and_timestamps_need_a_timezone() -> None:
    with pytest.raises(ValidationError):
        AgenteInicia.model_validate({**ENVELOPE, "seq": 0, "ronda": 0})
    with pytest.raises(ValidationError):
        AgenteInicia.model_validate({**ENVELOPE, "ts": datetime(2026, 11, 5), "ronda": 0})


def test_progress_messages_are_at_most_80_characters() -> None:
    AgenteProgreso.model_validate({**ENVELOPE, "mensaje": "x" * 80})
    with pytest.raises(ValidationError):
        AgenteProgreso.model_validate({**ENVELOPE, "mensaje": "x" * 81})


def test_round_trips_through_json() -> None:
    event = CorridaFin.model_validate(
        {
            **ENVELOPE,
            "agent": "sistema",
            "ts": datetime(2026, 11, 5, tzinfo=UTC),
            "estado": "completada",
            "puntajes": [],
            "totales": {"tokens_entrada": 1, "tokens_salida": 2, "latencia_ms": 3},
        }
    )

    assert evento_adapter.validate_json(evento_adapter.dump_json(event)) == event


def test_totals_add_usage_and_keep_cost_only_when_every_price_is_known() -> None:
    priced = [
        Uso(tokens_entrada=10, tokens_salida=5, latencia_ms=100, costo_usd=0.001),
        Uso(tokens_entrada=20, tokens_salida=5, latencia_ms=50, costo_usd=0.0025),
    ]

    totals = sumar_totales(priced)
    partial = sumar_totales([*priced, Uso(tokens_entrada=1, tokens_salida=1, latencia_ms=1)])

    assert (totals.tokens_entrada, totals.tokens_salida, totals.latencia_ms) == (30, 10, 150)
    assert totals.costo_usd == pytest.approx(0.0035)
    assert partial.costo_usd is None
