import logging
from pathlib import Path

import pytest
from pydantic import ValidationError
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIChatModel

from criteria.adapters.llm.catalog import (
    CatalogEntry,
    CatalogError,
    ModelCatalog,
    TierNotAvailableError,
    TokenProfile,
)
from criteria.adapters.llm.registry import (
    KeyRequiredError,
    ProviderNotAllowedError,
    ProviderRegistry,
)
from criteria.adapters.llm.ssrf import EndpointNotAllowedError
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import (
    Nivel,
    ProviderSelection,
    RolAgente,
    SelectionError,
    parse_selection,
)

USER_KEY = "sk-user-0000-very-secret"

CATALOG = ModelCatalog(
    models=[
        CatalogEntry(provider="openai", name="gpt-test-mini", display_name="gpt-test-mini"),
        CatalogEntry(provider="anthropic", name="claude-test", display_name="claude-test"),
        CatalogEntry(provider="groq", name="groq-test", display_name="groq-test"),
        CatalogEntry(
            provider="ollama",
            name="qwen3:8b",
            display_name="qwen3:8b",
            thinking=False,
            input_usd_per_million=0.0,
            output_usd_per_million=0.0,
        ),
        CatalogEntry(
            provider="openai",
            name="gpt-priced",
            display_name="gpt-priced",
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


ALL_SERVER = "openai,anthropic,groq,ollama"
PAID = ["openai", "anthropic", "groq"]
MODEL_FOR = {"openai": "gpt-test-mini", "anthropic": "claude-test", "groq": "groq-test"}


def user_selection(provider: str) -> ProviderSelection:
    if provider == "openai_compatible":
        return compatible()
    return parse_selection(
        {"proveedor": provider, "modelo": MODEL_FOR[provider], "api_key": USER_KEY}
    )


class TestAvailability:
    def test_server_access_needs_both_the_allow_list_and_a_configured_credential(self) -> None:
        assert registry().available() == []
        assert registry(openai_api_key="k", groq_api_key="g").available() == []
        assert registry(
            server_key_providers="openai,groq", openai_api_key="k", groq_api_key="g"
        ).available() == ["openai", "groq"]
        assert registry(
            server_key_providers="openai,anthropic", openai_api_key="k"
        ).available() == ["openai"]

    def test_user_keys_add_their_providers(self) -> None:
        reg = registry(server_key_providers="groq", groq_api_key="g")

        assert reg.available(user_keys=["anthropic", "openai_compatible", "ollama"]) == [
            "anthropic",
            "groq",
            "openai_compatible",
        ]

    def test_ollama_is_listed_only_with_a_base_url_and_when_allowed(self) -> None:
        assert "ollama" not in registry(server_key_providers="ollama").available()
        assert "ollama" not in registry(ollama_base_url="http://localhost:11434").available()
        assert (
            "ollama"
            in registry(
                server_key_providers="ollama", ollama_base_url="http://localhost:11434"
            ).available()
        )

    @pytest.mark.parametrize("provider", PAID)
    def test_runs_without_a_user_key_need_server_access(self, provider: str) -> None:
        selection = ProviderSelection.model_validate(
            {"proveedor": provider, "modelo": MODEL_FOR[provider]}
        )
        configured = registry(openai_api_key="k", anthropic_api_key="a", groq_api_key="g")

        with pytest.raises(KeyRequiredError, match="needs the user's own API key") as error:
            configured.validate(selection)

        assert error.value.codigo == "clave_requerida"

    def test_production_allows_only_groq_on_the_server_key(self) -> None:
        reg = registry(
            server_key_providers="groq", openai_api_key="k", anthropic_api_key="a", groq_api_key="g"
        )

        reg.validate(ProviderSelection(proveedor="groq", modelo="groq-test"))
        for provider in ("openai", "anthropic"):
            with pytest.raises(KeyRequiredError):
                reg.validate(
                    ProviderSelection.model_validate(
                        {"proveedor": provider, "modelo": MODEL_FOR[provider]}
                    )
                )

    @pytest.mark.parametrize("provider", [*PAID, "openai_compatible"])
    def test_a_user_key_works_without_server_access(self, provider: str) -> None:
        registry().validate(user_selection(provider))

    def test_models_outside_the_catalog_are_rejected(self) -> None:
        with pytest.raises(ProviderNotAllowedError, match="not allowed"):
            registry(server_key_providers="openai", openai_api_key="k").validate(
                ProviderSelection(proveedor="openai", modelo="gpt-unknown")
            )

    def test_server_keys_never_cover_user_endpoints(self) -> None:
        with pytest.raises(ValidationError, match="always needs the user's own key"):
            settings(server_key_providers="groq,openai_compatible")

    def test_allow_list_is_read_from_a_comma_separated_variable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", " anthropic, openai,groq,ollama,groq ")

        loaded = Settings(app_env="test")

        assert loaded.server_key_providers == ["anthropic", "openai", "groq", "ollama"]


class TestModels:
    def test_builds_each_server_provider(self) -> None:
        reg = registry(
            server_key_providers=ALL_SERVER,
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

    @pytest.mark.parametrize("provider", PAID)
    def test_user_key_replaces_the_server_key(self, provider: str) -> None:
        reg = registry(
            server_key_providers=ALL_SERVER,
            openai_api_key="server-k",
            anthropic_api_key="server-a",
            groq_api_key="server-g",
        )

        model = reg.model(user_selection(provider))

        assert model.client.api_key == USER_KEY  # type: ignore[attr-defined]

    def test_ollama_from_server_config_may_use_a_private_address(self) -> None:
        reg = registry(server_key_providers="ollama", ollama_base_url="http://192.168.1.50:11434")

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
        reg = registry(
            server_key_providers="ollama",
            ollama_base_url="http://localhost:11434",
            provider_timeout_seconds=30,
        )

        model_settings = reg.model_settings(
            ProviderSelection(proveedor="ollama", modelo="qwen3:8b", temperatura=0, max_tokens=512)
        )

        assert model_settings == {
            "temperature": 0,
            "max_tokens": 512,
            "timeout": 30,
            "thinking": False,
            "openai_reasoning_effort": "none",
        }

    def test_reasoning_effort_is_only_forced_for_local_models_with_thinking_off(self) -> None:
        reg = ProviderRegistry(settings(server_key_providers="groq", groq_api_key="g"), CATALOG)

        model_settings = reg.model_settings(ProviderSelection(proveedor="groq", modelo="groq-test"))

        assert "openai_reasoning_effort" not in model_settings
        assert "thinking" not in model_settings


class TestCatalog:
    def test_cost_uses_prices_per_million_tokens(self) -> None:
        selection = ProviderSelection(proveedor="openai", modelo="gpt-priced")

        assert registry().cost_usd(selection, 1_000, 500) == pytest.approx(0.0015)

    def test_cost_is_null_without_prices(self) -> None:
        selection = ProviderSelection(proveedor="openai", modelo="gpt-test-mini")

        assert registry().cost_usd(selection, 1_000, 500) is None
        assert registry().cost_usd(compatible(), 1_000, 500) is None

    def test_prices_must_come_in_pairs(self) -> None:
        with pytest.raises(ValidationError, match="both prices"):
            CatalogEntry(provider="openai", name="m", display_name="m", input_usd_per_million=1.0)

    def test_shipped_catalog_carries_the_verified_prices(self) -> None:
        catalog = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")

        assert catalog.allowed_models("ollama") == ["llama3.1:8b", "qwen3:8b"]
        assert catalog.cost_usd("openai", "gpt-5.4-mini", 1_000_000, 1_000_000) == 5.25
        assert catalog.cost_usd("anthropic", "claude-haiku-5-5", 1_000_000, 1_000_000) == 0.6
        for name in catalog.allowed_models("ollama"):
            assert catalog.cost_usd("ollama", name, 1_000_000, 1_000_000) == 0.0

    def test_load_reads_toml(self, tmp_path: Path) -> None:
        path = tmp_path / "models.toml"
        path.write_text(
            '[[models]]\nprovider = "groq"\nname = "m"\ndisplay_name = "M"\n', encoding="utf-8"
        )

        assert ModelCatalog.load(path).allows("groq", "m")

    def test_display_name_is_readable_and_unknown_models_keep_their_name(self) -> None:
        assert SHIPPED.display_name("groq", "openai/gpt-oss-20b") == "GPT-OSS 20B"
        assert SHIPPED.display_name("openai_compatible", "mi-modelo") == "mi-modelo"


USER_KEY_PROVIDERS = [*PAID, "openai_compatible"]


SHIPPED = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")


class TestTiers:
    @pytest.mark.parametrize(
        ("provider", "nivel", "model"),
        [
            ("openai", "economico", "gpt-6-luna"),
            ("openai", "equilibrado", "gpt-6.1-sol"),
            ("openai", "maximo", "gpt-6-astra"),
            ("anthropic", "economico", "claude-haiku-5-5"),
            ("anthropic", "equilibrado", "claude-sonnet-5-5"),
            ("anthropic", "maximo", "claude-opus-5-5"),
            ("groq", "economico", "openai/gpt-oss-20b"),
        ],
    )
    def test_shipped_tiers_resolve_to_their_model(
        self, provider: ProveedorId, nivel: Nivel, model: str
    ) -> None:
        assert SHIPPED.resolve(provider, nivel) == model

    @pytest.mark.parametrize(("provider", "nivel"), [("groq", "maximo"), ("ollama", "economico")])
    def test_missing_tiers_are_reported(self, provider: ProveedorId, nivel: Nivel) -> None:
        with pytest.raises(TierNotAvailableError, match=f"{provider} has no model for the {nivel}"):
            SHIPPED.resolve(provider, nivel)

    @pytest.mark.parametrize(
        ("provider", "name", "prices"),
        [
            ("openai", "gpt-6-luna", (0.10, 0.50)),
            ("openai", "gpt-6.1-sol", (2.0, 10.0)),
            ("openai", "gpt-6-astra", (10.0, 50.0)),
            ("openai", "gpt-5.4-mini", (0.75, 4.50)),
            ("anthropic", "claude-sonnet-5-5", (2.0, 10.0)),
            ("anthropic", "claude-opus-5-5", (4.0, 20.0)),
            ("groq", "openai/gpt-oss-20b", (0.075, 0.30)),
        ],
    )
    def test_shipped_prices(
        self, provider: ProveedorId, name: str, prices: tuple[float, float]
    ) -> None:
        entry = SHIPPED.entry(provider, name)

        assert entry is not None
        assert (entry.input_usd_per_million, entry.output_usd_per_million) == prices

    def test_untiered_models_stay_selectable_by_name(self) -> None:
        assert SHIPPED.entry("openai", "gpt-5.4-mini") is not None
        assert SHIPPED.entry("openai", "gpt-5.4-mini").nivel is None  # type: ignore[union-attr]
        assert SHIPPED.allowed_models("groq") == ["openai/gpt-oss-20b"]
        assert SHIPPED.entry("openai", "gpt-5.5") is None
        assert SHIPPED.entry("openai", "gpt-5.5-pro") is None

    def test_two_models_for_one_tier_are_rejected(self) -> None:
        with pytest.raises(
            ValidationError, match="groq has two models for the economico tier: a and b"
        ):
            ModelCatalog(
                models=[
                    CatalogEntry(provider="groq", name="a", display_name="a", nivel="economico"),
                    CatalogEntry(provider="groq", name="b", display_name="b", nivel="economico"),
                    CatalogEntry(provider="openai", name="c", display_name="c", nivel="economico"),
                ]
            )

    def test_a_duplicated_tier_stops_loading_with_a_clear_message(self, tmp_path: Path) -> None:
        path = tmp_path / "models.toml"
        entry = (
            '[[models]]\nprovider = "groq"\nname = "{0}"\ndisplay_name = "{0}"\nnivel = "maximo"\n'
        )
        path.write_text(entry.format("a") + entry.format("b"), encoding="utf-8")

        with pytest.raises(CatalogError, match=r"Invalid model catalog models\.toml: .*two models"):
            ModelCatalog.load(path)

    def test_selection_needs_a_model_or_a_tier(self) -> None:
        with pytest.raises(SelectionError, match="a model or a tier"):
            parse_selection({"proveedor": "groq"})
        with pytest.raises(ValueError, match="resolve the tier"):
            _ = ProviderSelection(proveedor="groq", nivel="economico").etiqueta

    def test_registry_resolves_tiers_and_an_explicit_model_wins(self) -> None:
        catalog = SHIPPED.model_copy(
            update={
                "models": [
                    *SHIPPED.models,
                    CatalogEntry(provider="groq", name="sin-nivel", display_name="Sin nivel"),
                ]
            }
        )
        reg = ProviderRegistry(settings(server_key_providers="groq", groq_api_key="g"), catalog)

        by_tier = reg.validate(ProviderSelection(proveedor="groq", nivel="economico"))
        explicit = reg.validate(
            ProviderSelection(proveedor="groq", nivel="economico", modelo="sin-nivel")
        )

        assert by_tier.etiqueta == "groq:openai/gpt-oss-20b"
        assert explicit.etiqueta == "groq:sin-nivel"
        assert reg.model(ProviderSelection(proveedor="groq", nivel="economico")).model_name == (
            "openai/gpt-oss-20b"
        )

    def test_unknown_tier_for_a_provider_is_not_allowed(self) -> None:
        reg = ProviderRegistry(settings(server_key_providers="groq", groq_api_key="g"), SHIPPED)

        with pytest.raises(ProviderNotAllowedError, match="maximo tier"):
            reg.validate(ProviderSelection(proveedor="groq", nivel="maximo"))
        with pytest.raises(ProviderNotAllowedError, match="openai_compatible has no model"):
            reg.cost_usd(
                parse_selection(
                    {
                        "proveedor": "openai_compatible",
                        "nivel": "economico",
                        "api_key": USER_KEY,
                        "base_url": "https://llm.example.com/v1",
                    }
                ),
                1,
                1,
            )


class TestTokenCap:
    def test_local_models_lower_the_cap_that_api_models_keep(self) -> None:
        reg = ProviderRegistry(
            settings(server_key_providers="groq,ollama", groq_api_key="g"), SHIPPED
        )
        local = ProviderSelection(proveedor="ollama", modelo="llama3.1:8b")
        hosted = ProviderSelection(proveedor="groq", nivel="economico")

        assert (local.max_tokens, hosted.max_tokens) == (16384, 16384)
        assert reg.max_tokens(local) == 8192
        assert reg.model_settings(local)["max_tokens"] == 8192
        assert reg.max_tokens(hosted) == 16384
        assert reg.max_tokens(local.model_copy(update={"max_tokens": 2048})) == 2048


class TestConsumptionProfile:
    def test_a_model_can_bring_its_own_profile_and_the_rest_keep_the_general_one(self) -> None:
        general: dict[RolAgente, TokenProfile] = {
            "analista": TokenProfile(input_tokens=1000, output_tokens=1000)
        }
        own: dict[RolAgente, TokenProfile] = {
            "analista": TokenProfile(input_tokens=1000, output_tokens=3000)
        }
        catalog = ModelCatalog(
            models=[
                CatalogEntry(
                    provider="groq",
                    name="razona",
                    display_name="Razona",
                    input_usd_per_million=1.0,
                    output_usd_per_million=1.0,
                    consumption_profile=own,
                ),
                CatalogEntry(
                    provider="groq",
                    name="normal",
                    display_name="Normal",
                    input_usd_per_million=1.0,
                    output_usd_per_million=1.0,
                ),
            ],
            consumption_profile=general,
        )

        assert catalog.estimate_agent("analista", ("groq", "razona")) == 0.004
        assert catalog.estimate_agent("analista", ("groq", "normal")) == 0.002
        assert catalog.estimate_agent("qa", ("groq", "razona")) is None
        assert catalog.profile_for("groq", "desconocido") == general


class TestOutputMode:
    def test_local_models_and_gpt_oss_use_native_output_and_the_rest_tool_calls(self) -> None:
        reg = ProviderRegistry(settings(), SHIPPED)
        assert reg.output_mode(ProviderSelection(proveedor="groq", nivel="economico")) == "native"

        assert reg.output_mode(ProviderSelection(proveedor="ollama", modelo="qwen3:8b")) == "native"
        assert (
            reg.output_mode(ProviderSelection(proveedor="ollama", modelo="llama3.1:8b")) == "native"
        )
        for provider in ("openai", "anthropic"):
            assert (
                reg.output_mode(ProviderSelection(proveedor=provider, nivel="economico")) == "tool"
            )
        assert (
            reg.output_mode(
                parse_selection(
                    {
                        "proveedor": "openai_compatible",
                        "modelo": "x",
                        "api_key": USER_KEY,
                        "base_url": "https://llm.example.com/v1",
                    }
                )
            )
            == "tool"
        )


class TestCostEstimate:
    def test_estimate_multiplies_the_profile_by_each_models_prices(self) -> None:
        reg = ProviderRegistry(settings(), SHIPPED)
        profile = SHIPPED.consumption_profile
        generation_tokens = [profile[r] for r in ("analista", "qa", "revisor")]
        expected = (
            sum(p.input_tokens * 0.10 + p.output_tokens * 0.50 for p in generation_tokens)
            + profile["evaluador"].input_tokens * 0.10
            + profile["evaluador"].output_tokens * 0.50
        ) / 1e6

        estimate = reg.estimate_run_cost(
            ProviderSelection(proveedor="openai", nivel="economico"),
            ProviderSelection(proveedor="anthropic", nivel="economico"),
        )

        assert estimate == pytest.approx(expected, abs=1e-6)

    def test_estimate_is_null_when_a_price_or_profile_is_missing(self) -> None:
        haiku = ProviderSelection(proveedor="anthropic", nivel="economico")
        unpriced = ProviderRegistry(
            settings(),
            SHIPPED.model_copy(
                update={
                    "models": [
                        *SHIPPED.models,
                        CatalogEntry(provider="openai", name="nuevo", display_name="nuevo"),
                    ]
                }
            ),
        )

        assert (
            unpriced.estimate_run_cost(ProviderSelection(proveedor="openai", modelo="nuevo"), haiku)
            is None
        )
        empty = ProviderRegistry(settings(), SHIPPED.model_copy(update={"consumption_profile": {}}))
        assert empty.estimate_run_cost(haiku, haiku) is None

    def test_local_models_estimate_zero(self) -> None:
        reg = ProviderRegistry(settings(ollama_base_url="http://127.0.0.1:11434"), SHIPPED)
        local = ProviderSelection(proveedor="ollama", modelo="llama3.1:8b")

        assert reg.estimate_run_cost(local, local) == 0.0


class TestUserKey:
    @pytest.mark.parametrize("provider", USER_KEY_PROVIDERS)
    def test_user_key_never_shows_in_repr_str_or_dumps(self, provider: str) -> None:
        selection = user_selection(provider)

        for text in (repr(selection), str(selection), selection.model_dump_json()):
            assert USER_KEY not in text
        assert selection.usa_clave_propia
        assert selection.api_key is not None
        assert selection.api_key.get_secret_value() == USER_KEY

    @pytest.mark.parametrize("provider", USER_KEY_PROVIDERS)
    def test_user_input_errors_never_hold_the_key(self, provider: str) -> None:
        with pytest.raises(SelectionError) as error:
            parse_selection(
                {"proveedor": provider, "modelo": "m", "api_key": USER_KEY, "temperatura": 9}
            )

        assert "temperatura" in str(error.value)
        for text in (str(error.value), repr(error.value), repr(error.value.args)):
            assert USER_KEY not in text
        assert error.value.__context__ is None
        assert error.value.__cause__ is None

    def test_ollama_takes_no_key_and_only_user_endpoints_take_a_base_url(self) -> None:
        with pytest.raises(SelectionError, match="ollama does not take an API key"):
            parse_selection({"proveedor": "ollama", "modelo": "m", "api_key": USER_KEY})
        with pytest.raises(SelectionError, match="only openai_compatible accepts a user base_url"):
            parse_selection(
                {
                    "proveedor": "groq",
                    "modelo": "m",
                    "api_key": USER_KEY,
                    "base_url": "https://x.io",
                }
            )
        with pytest.raises(SelectionError, match="needs its own"):
            parse_selection(
                {"proveedor": "openai_compatible", "modelo": "m", "base_url": "https://x.io"}
            )

    @pytest.mark.parametrize("provider", USER_KEY_PROVIDERS)
    def test_building_a_user_model_logs_nothing_about_the_key(
        self, provider: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        model = registry().model(user_selection(provider))

        assert USER_KEY not in caplog.text
        assert USER_KEY not in repr(model)
