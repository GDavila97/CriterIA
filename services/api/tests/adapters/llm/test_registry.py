import logging
from pathlib import Path

import pytest
from pydantic import ValidationError
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIChatModel

from criteria.adapters.llm.catalog import CatalogEntry, ModelCatalog
from criteria.adapters.llm.registry import ProviderNotAllowedError, ProviderRegistry
from criteria.adapters.llm.ssrf import EndpointNotAllowedError
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.run_config import ProviderSelection, SelectionError, parse_selection

USER_KEY = "sk-user-0000-very-secret"

CATALOG = ModelCatalog(
    models=[
        CatalogEntry(provider="openai", name="gpt-test-mini"),
        CatalogEntry(provider="anthropic", name="claude-test"),
        CatalogEntry(provider="groq", name="groq-test"),
        CatalogEntry(
            provider="ollama",
            name="qwen3:8b",
            thinking=False,
            input_usd_per_million=0.0,
            output_usd_per_million=0.0,
        ),
        CatalogEntry(
            provider="openai",
            name="gpt-priced",
            input_usd_per_million=0.5,
            output_usd_per_million=2.0,
        ),
    ]
)


def settings(**overrides: object) -> Settings:
    return Settings.model_validate({"app_env": "test", **overrides})


def registry(**overrides: object) -> ProviderRegistry:
    return ProviderRegistry(settings(**overrides), CATALOG)


def compatible(base_url: str = "https://llm.example.com/v1") -> ProviderSelection:
    return parse_selection(
        {
            "proveedor": "openai_compatible",
            "modelo": "any-model",
            "api_key": USER_KEY,
            "base_url": base_url,
        }
    )


class TestAvailability:
    def test_only_configured_providers_are_listed(self) -> None:
        assert registry().available() == ["openai_compatible"]
        assert registry(openai_api_key="k", groq_api_key="g").available() == [
            "openai",
            "groq",
            "openai_compatible",
        ]

    def test_ollama_is_listed_only_with_a_base_url(self) -> None:
        assert "ollama" not in registry().available()
        assert "ollama" in registry(ollama_base_url="http://localhost:11434").available()

    def test_unconfigured_provider_is_rejected(self) -> None:
        with pytest.raises(ProviderNotAllowedError, match="not configured"):
            registry().validate(ProviderSelection(proveedor="ollama", modelo="qwen3:8b"))

    def test_models_outside_the_catalog_are_rejected(self) -> None:
        with pytest.raises(ProviderNotAllowedError, match="not allowed"):
            registry(openai_api_key="k").validate(
                ProviderSelection(proveedor="openai", modelo="gpt-unknown")
            )


class TestModels:
    def test_builds_each_server_provider(self) -> None:
        reg = registry(
            openai_api_key="k",
            anthropic_api_key="a",
            groq_api_key="g",
            ollama_base_url="http://localhost:11434",
        )

        assert isinstance(
            reg.model(ProviderSelection(proveedor="openai", modelo="gpt-test-mini")),
            OpenAIChatModel,
        )
        assert isinstance(
            reg.model(ProviderSelection(proveedor="anthropic", modelo="claude-test")),
            AnthropicModel,
        )
        assert isinstance(
            reg.model(ProviderSelection(proveedor="groq", modelo="groq-test")), GroqModel
        )
        assert isinstance(
            reg.model(ProviderSelection(proveedor="ollama", modelo="qwen3:8b")), OllamaModel
        )

    def test_ollama_from_server_config_may_use_a_private_address(self) -> None:
        reg = registry(ollama_base_url="http://192.168.1.50:11434")

        model = reg.model(ProviderSelection(proveedor="ollama", modelo="qwen3:8b"))

        assert model.base_url == "http://192.168.1.50:11434/v1/"

    def test_user_endpoint_with_the_same_private_address_is_rejected(self) -> None:
        reg = registry(ollama_base_url="http://192.168.1.50:11434")

        with pytest.raises(EndpointNotAllowedError):
            reg.model(compatible("https://192.168.1.50:11434/v1"))

    def test_user_endpoint_must_use_https(self) -> None:
        with pytest.raises(EndpointNotAllowedError, match="https"):
            registry().model(compatible("http://llm.example.com/v1"))

    def test_user_endpoint_builds_an_openai_compatible_model(self) -> None:
        model = registry().model(compatible())

        assert isinstance(model, OpenAIChatModel)
        assert model.base_url == "https://llm.example.com/v1/"

    def test_model_settings_carry_run_parameters_and_catalog_thinking(self) -> None:
        reg = registry(ollama_base_url="http://localhost:11434", provider_timeout_seconds=30)

        model_settings = reg.model_settings(
            ProviderSelection(proveedor="ollama", modelo="qwen3:8b", temperatura=0, max_tokens=512)
        )

        assert model_settings == {
            "temperature": 0,
            "max_tokens": 512,
            "timeout": 30,
            "thinking": False,
        }


class TestCatalog:
    def test_cost_uses_prices_per_million_tokens(self) -> None:
        selection = ProviderSelection(proveedor="openai", modelo="gpt-priced")

        assert registry(openai_api_key="k").cost_usd(selection, 1_000, 500) == pytest.approx(0.0015)

    def test_cost_is_null_without_prices(self) -> None:
        selection = ProviderSelection(proveedor="openai", modelo="gpt-test-mini")

        assert registry(openai_api_key="k").cost_usd(selection, 1_000, 500) is None
        assert registry().cost_usd(compatible(), 1_000, 500) is None

    def test_prices_must_come_in_pairs(self) -> None:
        with pytest.raises(ValidationError, match="both prices"):
            CatalogEntry(provider="openai", name="m", input_usd_per_million=1.0)

    def test_shipped_catalog_carries_the_verified_prices(self) -> None:
        catalog = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")

        assert catalog.allowed_models("ollama") == ["qwen3:8b", "llama3.1:8b"]
        assert catalog.cost_usd("openai", "gpt-5.4-mini", 1_000_000, 1_000_000) == 5.25
        assert catalog.cost_usd("anthropic", "claude-haiku-5-5", 1_000_000, 1_000_000) == 0.6
        for free in ("groq", "ollama"):
            for name in catalog.allowed_models(free):
                assert catalog.cost_usd(free, name, 1_000_000, 1_000_000) == 0.0

    def test_load_reads_toml(self, tmp_path: Path) -> None:
        path = tmp_path / "models.toml"
        path.write_text('[[models]]\nprovider = "groq"\nname = "m"\n', encoding="utf-8")

        assert ModelCatalog.load(path).allows("groq", "m")


class TestUserKey:
    def test_user_key_never_shows_in_repr_str_or_dumps(self) -> None:
        selection = compatible()

        for text in (repr(selection), str(selection), selection.model_dump_json()):
            assert USER_KEY not in text
        assert selection.usa_clave_propia
        assert selection.api_key is not None
        assert selection.api_key.get_secret_value() == USER_KEY

    def test_user_input_errors_never_hold_the_key(self) -> None:
        with pytest.raises(SelectionError) as error:
            parse_selection({"proveedor": "openai", "modelo": "m", "api_key": USER_KEY})

        assert "only openai_compatible" in str(error.value)
        for text in (str(error.value), repr(error.value), repr(error.value.args)):
            assert USER_KEY not in text
        assert error.value.__context__ is None
        assert error.value.__cause__ is None

    def test_user_key_is_only_for_openai_compatible(self) -> None:
        with pytest.raises(SelectionError, match="only openai_compatible"):
            parse_selection({"proveedor": "groq", "modelo": "m", "api_key": USER_KEY})
        with pytest.raises(SelectionError, match="needs its own"):
            parse_selection(
                {"proveedor": "openai_compatible", "modelo": "m", "base_url": "https://x.io"}
            )

    def test_building_a_user_model_logs_nothing_about_the_key(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        registry().model(compatible())

        assert USER_KEY not in caplog.text
