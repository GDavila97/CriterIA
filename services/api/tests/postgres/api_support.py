import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import psycopg
import pytest

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.agents.runner import ModelBinding
from criteria.adapters.http.services import ApiServices
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.system_clock import SystemClock
from criteria.bootstrap import ApiOverrides
from criteria.config import SERVICE_ROOT, ApiSettings
from criteria.domain.run_config import ProviderSelection
from criteria.main import create_app
from criteria.ports.agents import AgentSet
from tests import factories as f
from tests.agent_models import ScriptedTeam, make_binding, team
from tests.fakes import FakeKeyValidator
from tests.http.support import TokenFactory, api_settings
from tests.postgres.database import Database

CATALOG = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")
APP_TABLES = (
    "run_event",
    "run",
    "run_start",
    "usage_daily",
    "global_usage_daily",
    "saved_run",
    "provider_credential",
    "credential_check",
    "user_settings",
    "eval_result",
    "human_score",
    "eval_batch",
    "eval_case",
)


def happy_team() -> ScriptedTeam:
    return team(
        analista=[f.historias(1)],
        qa=[f.entrega_qa(1)],
        revisor=[f.veredicto()],
        evaluador=[f.evaluacion(4)],
    )


@dataclass
class Api:
    client: httpx.AsyncClient
    tokens: TokenFactory
    services: ApiServices
    database: Database
    settings: ApiSettings
    validator: FakeKeyValidator
    team: ScriptedTeam = field(default_factory=happy_team)
    selections: list[tuple[ProviderSelection, ProviderSelection]] = field(default_factory=list)

    def headers(self, user: str = "user-1", verified: bool = True) -> dict[str, str]:
        return self.tokens.headers(user, verified)

    def sql(self, statement: str, *params: Any) -> list[tuple[Any, ...]]:
        with psycopg.connect(self.database.admin, autocommit=True) as conn:
            cursor = conn.execute(statement, params or None)
            return cursor.fetchall() if cursor.description else []

    async def create_run(self, user: str = "user-1", **body: Any) -> httpx.Response:
        return await self.client.post(
            "/runs",
            json={"requerimiento": f.REQUERIMIENTO, **body},
            headers=self.headers(user),
        )

    async def stream(
        self, run_id: str, user: str = "user-1", last_event_id: int | None = None
    ) -> tuple[httpx.Response, list[dict[str, Any]]]:
        headers = self.headers(user)
        if last_event_id is not None:
            headers["last-event-id"] = str(last_event_id)
        response = await self.client.get(f"/runs/{run_id}/stream", headers=headers)
        return response, parse_sse(response.text)


def parse_sse(text: str) -> list[dict[str, Any]]:
    events = []
    for frame in text.split("\n\n"):
        lines = [line for line in frame.splitlines() if line and not line.startswith(":")]
        data = next((line[len("data: ") :] for line in lines if line.startswith("data: ")), None)
        if data is not None:
            event = json.loads(data)
            assert f"id: {event['seq']}" in lines
            events.append(event)
    return events


def _binding(scripted: ScriptedTeam, selection: ProviderSelection) -> ModelBinding:
    base = make_binding(scripted, selection.etiqueta, provider=selection.proveedor)
    modelo = selection.modelo or ""
    return ModelBinding(
        model=base.model,
        provider=selection.proveedor,
        label=base.label,
        settings=base.settings,
        cost_usd=lambda i, o: CATALOG.cost_usd(selection.proveedor, modelo, i, o),
    )


def agent_builder(
    api_ref: Callable[[], Api],
) -> Callable[[ProviderSelection, ProviderSelection], AgentSet]:
    def build(generation: ProviderSelection, judge: ProviderSelection) -> AgentSet:
        api = api_ref()
        api.selections.append((generation, judge))
        factory = AgentFactory(SERVICE_ROOT / "prompts", "v1", "v1", SystemClock())
        return factory.build(_binding(api.team, generation), _binding(api.team, judge))

    return build


@pytest.fixture
async def api(database: Database, request: pytest.FixtureRequest) -> AsyncIterator[Api]:
    with psycopg.connect(database.admin, autocommit=True) as conn:
        tables = ", ".join(f"app.{name}" for name in APP_TABLES)
        conn.execute(
            f"TRUNCATE {tables}, graph.checkpoints, graph.checkpoint_blobs, graph.checkpoint_writes"
        )
    marker = request.node.get_closest_marker("api_settings")
    overrides_kwargs: dict[str, Any] = dict(marker.kwargs) if marker else {}
    settings = api_settings(database_url=database.api, **overrides_kwargs)
    tokens = TokenFactory()
    validator = FakeKeyValidator()
    holder: list[Api] = []
    app = create_app(
        settings,
        ApiOverrides(
            jwks_fetcher=tokens.fetch,
            key_validator=validator,
            agent_builder=agent_builder(lambda: holder[0]),
        ),
    )
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as client:
            holder.append(
                Api(
                    client=client,
                    tokens=tokens,
                    services=app.state.services,
                    database=database,
                    settings=settings,
                    validator=validator,
                )
            )
            yield holder[0]
