"""Calls a real Ollama server. Excluded by default; run with: uv run pytest -m ollama --no-cov"""

import os
from uuid import uuid4

import pytest

from criteria.adapters.memory.events import ListEventSink
from criteria.application.runs import EsperandoAprobacion, Terminada
from criteria.bootstrap import build_container
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Requerimiento
from criteria.domain.events import AgenteEntrega, AgenteError
from criteria.domain.run_config import ProviderSelection

# Read at import time: the autouse fixture clears the environment before each test.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL")
CANDIDATES = ["qwen3:8b", "llama3.1:8b"]
EXAMPLES = ["biblioteca", "citas-medicas", "nomina"]

pytestmark = [
    pytest.mark.ollama,
    pytest.mark.skipif(OLLAMA_BASE_URL is None, reason="OLLAMA_BASE_URL is not set"),
]


@pytest.mark.parametrize("example", EXAMPLES)
@pytest.mark.parametrize("model", CANDIDATES)
async def test_example_runs_end_to_end(model: str, example: str) -> None:
    settings = Settings.model_validate({"app_env": "test", "ollama_base_url": OLLAMA_BASE_URL})
    container = build_container(settings)
    selection = ProviderSelection(proveedor="ollama", modelo=model, temperatura=0)
    agents = container.agents(selection, selection)
    events = ListEventSink(uuid4(), container.clock)
    texto = (SERVICE_ROOT / "examples" / f"{example}.txt").read_text(encoding="utf-8")

    outcome = await container.service.iniciar(
        requerimiento=Requerimiento(texto=texto),
        agents=agents,
        events=events,
        max_rondas=settings.max_review_rounds,
    )
    if isinstance(outcome, EsperandoAprobacion):
        outcome = await container.service.reanudar(
            respuesta=RespuestaHumana(decision="aprobado"), agents=agents, events=events
        )

    assert isinstance(outcome, Terminada)
    errors = [e for e in events.events if isinstance(e, AgenteError)]
    assert errors == [], [f"{e.agent}: {e.codigo}" for e in errors]
    assert outcome.estado == "completada"
    assert {e.agent for e in events.events if isinstance(e, AgenteEntrega)} == {
        "analista",
        "qa",
        "revisor",
        "evaluador",
    }
