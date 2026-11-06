from dataclasses import dataclass
from datetime import timedelta

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.agents.runner import ModelBinding
from criteria.adapters.auth.jwks import (
    JwksCache,
    JwksFetcher,
    JwtVerifier,
    TokenPolicy,
    http_jwks_fetcher,
)
from criteria.adapters.crypto.aesgcm import AesGcmCipher
from criteria.adapters.http.services import ApiServices
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.key_validator import HttpKeyValidator
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.adapters.postgres.database import (
    PostgresCheckpointer,
    create_checkpoint_pool,
    create_engine,
)
from criteria.adapters.postgres.stores import (
    PostgresCredentialStore,
    PostgresEvaluationReader,
    PostgresHistoryStore,
    PostgresRunStore,
    PostgresSettingsStore,
    PostgresUsageGuard,
)
from criteria.adapters.system_clock import SystemClock
from criteria.application.accounts import AccountService
from criteria.application.credentials import CredentialService
from criteria.application.run_api import AgentBuilder, RunApplication, RunDefaults
from criteria.application.runs import RunService
from criteria.config import ApiSettings, Settings
from criteria.domain.run_config import ProviderSelection
from criteria.observability import SentryErrorReporter
from criteria.ports.agents import AgentSet
from criteria.ports.clock import Clock
from criteria.ports.errors import ErrorReporter
from criteria.ports.keys import KeyValidator
from criteria.ports.stores import UsageLimits


@dataclass
class Container:
    settings: Settings
    registry: ProviderRegistry
    clock: Clock
    service: RunService

    def binding(self, selection: ProviderSelection) -> ModelBinding:
        registry = self.registry
        selection = registry.validate(selection)
        return ModelBinding(
            model=registry.model(selection),
            provider=selection.proveedor,
            label=selection.etiqueta,
            settings=registry.model_settings(selection),
            output_mode=registry.output_mode(selection),
            cost_usd=lambda tokens_in, tokens_out: registry.cost_usd(
                selection, tokens_in, tokens_out
            ),
        )

    def agents(self, generacion: ProviderSelection, juez: ProviderSelection) -> AgentSet:
        settings = self.settings
        factory = AgentFactory(
            settings.prompts_dir, settings.prompt_version, settings.judge_version, self.clock
        )
        return factory.build(self.binding(generacion), self.binding(juez))


def build_container(settings: Settings) -> Container:
    catalog = ModelCatalog.load(settings.models_file)
    return Container(
        settings=settings,
        registry=ProviderRegistry(settings, catalog),
        clock=SystemClock(),
        service=RunService(MemoryCheckpointer()),
    )


@dataclass(frozen=True)
class ApiOverrides:
    """Injection points for tests; production leaves every field empty."""

    jwks_fetcher: JwksFetcher | None = None
    key_validator: KeyValidator | None = None
    agent_builder: AgentBuilder | None = None
    clock: Clock | None = None
    reporter: ErrorReporter | None = None


def build_api_services(settings: ApiSettings, overrides: ApiOverrides | None = None) -> ApiServices:
    overrides = overrides or ApiOverrides()
    clock = overrides.clock or SystemClock()
    database_url = settings.database_url.get_secret_value()
    engine = create_engine(database_url, settings.database_pool_size)
    checkpoint_pool = create_checkpoint_pool(database_url, settings.database_pool_size)
    checkpointer = PostgresCheckpointer(checkpoint_pool)
    registry = ProviderRegistry(settings, ModelCatalog.load(settings.models_file))
    container = Container(
        settings=settings,
        registry=registry,
        clock=clock,
        service=RunService(checkpointer),
    )
    credentials = CredentialService(
        store=PostgresCredentialStore(engine),
        cipher=AesGcmCipher(settings.credential_keys(), settings.credentials_active_key),
        validator=overrides.key_validator
        or HttpKeyValidator(
            timeout_seconds=10, max_response_bytes=settings.provider_max_response_bytes
        ),
        clock=clock,
        checks_per_hour=settings.credential_checks_per_hour,
    )
    user_settings = PostgresSettingsStore(engine)
    history = PostgresHistoryStore(engine)
    default_provider = settings.provider or "groq"
    runs = RunApplication(
        runs=PostgresRunStore(engine),
        usage=PostgresUsageGuard(
            engine,
            UsageLimits(
                user_runs_per_hour=settings.user_runs_per_hour,
                user_runs_per_day=settings.user_runs_per_day,
                global_daily_runs=settings.global_daily_runs,
                global_daily_budget_usd=settings.global_daily_budget_usd,
            ),
        ),
        credentials=credentials,
        settings=user_settings,
        history=history,
        router=registry,
        build_agents=overrides.agent_builder or container.agents,
        service=container.service,
        checkpointer=checkpointer,
        clock=clock,
        defaults=RunDefaults(
            provider=default_provider,
            max_rounds=settings.max_review_rounds,
            abandoned_after=timedelta(minutes=settings.run_ttl_minutes),
            heartbeat_seconds=settings.sse_heartbeat_seconds,
        ),
        reporter=overrides.reporter or SentryErrorReporter(),
    )
    verifier = JwtVerifier(
        JwksCache(
            overrides.jwks_fetcher or http_jwks_fetcher(str(settings.auth_jwks_url)),
            clock,
            settings.auth_jwks_cache_seconds,
        ),
        TokenPolicy(
            issuer=settings.auth_issuer,
            audience=settings.auth_audience,
            algorithms=frozenset(settings.auth_algorithms),
            verified_claim=settings.auth_verified_claim,
            leeway_seconds=settings.auth_leeway_seconds,
        ),
    )

    async def startup() -> None:
        await checkpoint_pool.open(wait=True)
        await checkpointer.ensure_migrated()

    async def shutdown() -> None:
        await checkpoint_pool.close()
        await engine.dispose()

    return ApiServices(
        verifier=verifier,
        runs=runs,
        credentials=credentials,
        accounts=AccountService(
            settings=user_settings,
            history=history,
            credentials=credentials,
            router=registry,
            default_provider=default_provider,
        ),
        evaluation=PostgresEvaluationReader(engine),
        startup=startup,
        shutdown=shutdown,
    )
