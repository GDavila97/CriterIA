import logging
import os
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic import SecretStr

from criteria.adapters.crypto.aesgcm import AesGcmCipher
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.application.accounts import AccountService, AgentPrompts
from criteria.application.credentials import CredentialService
from criteria.application.errors import (
    CredentialRejectedError,
    InvalidInputError,
    NotFoundError,
)
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.run_config import ROLES
from criteria.ports.stores import LimitExceededError, SavedRun, UserSettings
from tests import factories as f
from tests.application.memory_stores import (
    MemoryCredentials,
    MemoryHistory,
    MemorySettings,
    MemoryUsage,
)
from tests.fakes import FakeClock, FakeKeyValidator

CATALOG = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")
USER = "user-1"
KEY = SecretStr("sk-user-secret-9f3A")


def credential_service(
    store: MemoryCredentials | None = None, checks_per_hour: int = 10
) -> CredentialService:
    return CredentialService(
        store=store or MemoryCredentials(),
        cipher=AesGcmCipher({1: os.urandom(32)}, 1),
        validator=FakeKeyValidator(),
        clock=FakeClock(),
        checks_per_hour=checks_per_hour,
    )


class TestCredentialService:
    async def test_saved_keys_resolve_back_only_for_their_owner(self) -> None:
        service = credential_service()

        summary = await service.save(USER, "openai", KEY, None)
        mine = await service.resolve(USER, "openai")

        assert summary.last4 == "9f3A"
        assert mine is not None
        assert mine.api_key.get_secret_value() == KEY.get_secret_value()
        assert await service.resolve("other", "openai") is None
        assert await service.providers(USER) == {"openai"}

    async def test_a_ciphertext_moved_to_another_user_does_not_decrypt(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        store = MemoryCredentials()
        service = credential_service(store)
        await service.save(USER, "openai", KEY, None)
        store.rows[("thief", "openai")] = store.rows[(USER, "openai")]

        with caplog.at_level(logging.WARNING):
            assert await service.resolve("thief", "openai") is None

        assert KEY.get_secret_value() not in caplog.text

    @pytest.mark.parametrize(
        ("provider", "key", "base_url"),
        [
            ("ollama", "sk-1234", None),
            ("openai", "   ", None),
            ("openai", "x" * 513, None),
            ("openai_compatible", "sk-1234", None),
            ("anthropic", "sk-1234", "https://llm.example.com/v1"),
        ],
    )
    async def test_malformed_requests_are_refused_before_validating(
        self, provider: str, key: str, base_url: str | None
    ) -> None:
        service = credential_service()

        with pytest.raises(InvalidInputError):
            await service.save(USER, provider, SecretStr(key), base_url)  # type: ignore[arg-type]

    @pytest.mark.parametrize(
        ("key", "code"), [("sk-bad-1", "clave_invalida"), ("sk-down-1", "clave_no_verificable")]
    )
    async def test_rejected_keys_carry_their_code_and_are_not_kept(
        self, key: str, code: str
    ) -> None:
        store = MemoryCredentials()

        with pytest.raises(CredentialRejectedError) as error:
            await credential_service(store).save(USER, "groq", SecretStr(key), None)

        assert error.value.codigo == code
        assert store.rows == {}
        assert key not in str(error.value)

    async def test_failed_checks_still_count_towards_the_hourly_limit(self) -> None:
        service = credential_service(checks_per_hour=2)
        for _ in range(2):
            with pytest.raises(CredentialRejectedError):
                await service.save(USER, "groq", SecretStr("sk-bad-1"), None)

        with pytest.raises(LimitExceededError) as error:
            await service.save(USER, "groq", KEY, None)

        assert error.value.codigo == "limite_validaciones"

    async def test_listing_and_deleting(self) -> None:
        service = credential_service()
        await service.save(USER, "openai_compatible", KEY, "https://llm.example.com/v1")

        [listed] = await service.list(USER)
        deleted = await service.delete(USER, "openai_compatible")

        assert listed.base_url == "https://llm.example.com/v1"
        assert deleted is True
        assert await service.delete(USER, "openai_compatible") is False


def account_service(**settings: object) -> tuple[AccountService, CredentialService, MemoryHistory]:
    credentials = credential_service()
    history = MemoryHistory()
    registry = ProviderRegistry(
        Settings.model_validate(
            {
                "app_env": "test",
                "server_key_providers": "groq",
                "groq_api_key": "server-groq-key",
                **settings,
            }
        ),
        CATALOG,
    )
    service = AccountService(
        settings=MemorySettings(),
        history=history,
        credentials=credentials,
        router=registry,
        default_provider="groq",
        usage=MemoryUsage(),
        clock=FakeClock(),
        prompts=AgentPrompts(
            version_prompts="v1",
            version_juez="v1",
            prompts={rol: f"prompt de {rol}" for rol in ROLES},
        ),
    )
    return service, credentials, history


class TestAccountService:
    async def test_settings_round_trip(self) -> None:
        service, _, _ = account_service()
        wanted = UserSettings(save_history=True, default_provider="groq", default_tier="economico")

        assert await service.settings(USER) == UserSettings()
        assert await service.update_settings(USER, wanted) == wanted
        assert await service.settings(USER) == wanted

    @pytest.mark.parametrize(
        "bad",
        [
            UserSettings(default_tier="maximo"),
            UserSettings(default_provider="nadie"),  # type: ignore[arg-type]
            UserSettings(judge_provider="nadie"),  # type: ignore[arg-type]
        ],
    )
    async def test_inconsistent_settings_are_refused(self, bad: UserSettings) -> None:
        service, _, _ = account_service()

        with pytest.raises(InvalidInputError):
            await service.update_settings(USER, bad)

    async def test_history_is_read_per_user(self) -> None:
        service, _, history = account_service()
        saved = SavedRun(
            id=uuid4(),
            status="completada",
            requirement=f.REQUERIMIENTO,
            artifacts={},
            scores=[],
            provider="groq",
            model="openai/gpt-oss-20b",
            judge_model="groq:openai/gpt-oss-20b",
            prompt_version="v1",
            judge_version="v1",
            experimental=False,
            totals={},
            created_at=None,
        )
        await history.save(USER, saved)

        assert [item.id for item in await service.history(USER)] == [saved.id]
        assert await service.history_item(USER, saved.id) == saved
        with pytest.raises(NotFoundError):
            await service.history_item("other", saved.id)
        assert await service.clear_history(USER) == 1
        assert await service.history(USER) == []

    async def test_the_catalog_prices_tiers_with_the_default_judge(self) -> None:
        service, credentials, _ = account_service()
        await credentials.save(USER, "anthropic", KEY, None)

        catalog = await service.catalog(USER)

        by_provider = {p.proveedor: p for p in catalog.proveedores}
        assert catalog.juez_predeterminado in {"groq", "anthropic"}
        assert by_provider["anthropic"].clave == "usuario"
        assert by_provider["ollama"].disponible is False
        assert by_provider["openai_compatible"].niveles == []
        assert all(t.costo_estimado_usd is not None for t in by_provider["anthropic"].niveles)

    async def test_a_preferred_judge_and_provider_shape_the_catalog(self) -> None:
        service, credentials, _ = account_service(ollama_base_url="http://127.0.0.1:11434")
        await credentials.save(USER, "openai", KEY, None)
        await service.update_settings(
            USER, replace(UserSettings(), default_provider="openai", judge_provider="openai")
        )

        catalog = await service.catalog(USER)

        assert (catalog.proveedor_predeterminado, catalog.juez_predeterminado) == (
            "openai",
            "openai",
        )
        ollama = next(p for p in catalog.proveedores if p.proveedor == "ollama")
        assert ollama.modelos == ["llama3.1:8b", "qwen3:8b"]

    async def test_the_catalog_prices_generation_and_judge_apart(self) -> None:
        service, credentials, _ = account_service(ollama_base_url="http://127.0.0.1:11434")
        await credentials.save(USER, "anthropic", KEY, None)

        catalog = await service.catalog(USER)

        by_provider = {p.proveedor: p for p in catalog.proveedores}
        local = {c.modelo: c.costo_usd for c in by_provider["ollama"].costos_generacion}
        assert local == {"llama3.1:8b": 0.0, "qwen3:8b": 0.0}
        assert by_provider["ollama"].costo_juez_usd is None
        anthropic = by_provider["anthropic"]
        haiku = next(c for c in anthropic.costos_generacion if c.modelo == "claude-haiku-5-5")
        assert haiku.costo_usd is not None
        assert haiku.costo_usd > 0
        assert anthropic.costo_juez_usd is not None
        assert anthropic.costo_juez_usd > 0
        assert by_provider["openai_compatible"].costos_generacion == []

    async def test_the_catalog_names_every_model_for_people(self) -> None:
        service, _, _ = account_service()

        catalog = await service.catalog(USER)

        groq = next(p for p in catalog.proveedores if p.proveedor == "groq")
        assert groq.display_names["openai/gpt-oss-20b"] == "GPT-OSS 20B"
        assert next(t for t in groq.niveles if t.nivel == "economico").display_name == (
            "GPT-OSS 20B"
        )
        assert set(groq.display_names) == set(groq.modelos)

    def test_display_names_fall_back_to_the_stored_name(self) -> None:
        service, _, _ = account_service()

        assert service.display_name("anthropic", "claude-opus-5-5") == "Claude Opus 5.5"
        assert service.judge_display_name("groq:openai/gpt-oss-20b") == "GPT-OSS 20B"
        assert service.judge_display_name("ollama:qwen3:8b") == "Qwen3 8B"
        assert service.display_name("openai_compatible", "mi-modelo") == "mi-modelo"
        assert service.display_name("desconocido", "x") == "x"
        assert service.judge_display_name("sin-proveedor") == "sin-proveedor"
