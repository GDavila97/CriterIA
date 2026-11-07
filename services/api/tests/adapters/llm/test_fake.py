from uuid import uuid4

import pytest
from pydantic import SecretStr

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.fake import FakeKeyValidator, fake_agent_builder
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.adapters.memory.events import ListEventSink
from criteria.application.runs import EsperandoAprobacion, RunService, Terminada
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Requerimiento
from criteria.domain.events import AgenteError, CorridaFin, EnEsperaHumano, RevisorObserva
from criteria.domain.run_config import AgentSelections, ProviderSelection
from criteria.ports.agents import AgentSet
from tests import factories as f
from tests.fakes import FakeClock

CATALOG = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")


def registry() -> ProviderRegistry:
    settings = Settings.model_validate(
        {"app_env": "test", "server_key_providers": "groq", "groq_api_key": "unused"}
    )
    return ProviderRegistry(settings, CATALOG)


def build(selection: ProviderSelection) -> tuple[RunService, ListEventSink, AgentSet]:
    clock = FakeClock()
    factory = AgentFactory(SERVICE_ROOT / "prompts", "v1", "v1", clock)
    builder = fake_agent_builder(registry(), factory, delay_seconds=0)
    agents = builder(AgentSelections.uniforme(selection, selection))
    return RunService(MemoryCheckpointer()), ListEventSink(uuid4(), clock), agents


async def test_a_fake_run_goes_through_the_real_graph_with_one_correction() -> None:
    service, events, agents = build(ProviderSelection(proveedor="groq", nivel="economico"))

    waiting = await service.iniciar(
        requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
        agents=agents,
        events=events,
        max_rondas=2,
    )
    assert isinstance(waiting, EsperandoAprobacion)
    assert len(waiting.historias.historias) == 3
    again = await service.reanudar(
        respuesta=RespuestaHumana(decision="otra_version", nota="Menos historias"),
        agents=agents,
        events=events,
    )
    assert isinstance(again, EsperandoAprobacion)
    assert len(again.historias.historias) == 2
    done = await service.reanudar(
        respuesta=RespuestaHumana(decision="aprobado"), agents=agents, events=events
    )

    assert isinstance(done, Terminada)
    assert done.estado == "completada"
    observa = [e for e in events.events if isinstance(e, RevisorObserva)]
    assert len(observa) == 1
    fin = events.events[-1]
    assert isinstance(fin, CorridaFin)
    assert fin.totales.costo_usd is not None
    assert len([e for e in events.events if isinstance(e, EnEsperaHumano)]) == 2


async def test_a_key_marked_without_balance_fails_like_a_provider_would() -> None:
    selection = ProviderSelection(
        proveedor="openai", nivel="economico", api_key=SecretStr("nosaldo-0000")
    )
    service, events, agents = build(selection)

    done = await service.iniciar(
        requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
        agents=agents,
        events=events,
        max_rondas=2,
    )

    assert isinstance(done, Terminada)
    error = next(e for e in events.events if isinstance(e, AgenteError))
    assert (error.codigo, error.respaldo_sugerido) == ("sin_saldo", "groq")


@pytest.mark.parametrize(
    ("key", "estado"),
    [("sk-ok-1234", "valida"), ("sk-bad-1", "invalida"), ("sk-down-1", "no_verificable")],
)
async def test_the_fake_validator_never_touches_the_network(key: str, estado: str) -> None:
    check = await FakeKeyValidator().validate("openai", SecretStr(key))

    assert check.estado == estado
    assert check.last4 == key[-4:]
