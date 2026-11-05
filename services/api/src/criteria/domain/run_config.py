from collections.abc import Mapping
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    SecretStr,
    StringConstraints,
    ValidationError,
    model_validator,
)

from criteria.domain.events import ProveedorId

USER_KEY_PROVIDERS: frozenset[ProveedorId] = frozenset(
    {"openai", "anthropic", "groq", "openai_compatible"}
)

NombreModelo = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$")]
Nivel = Literal["economico", "equilibrado", "maximo"]


class ProviderSelection(BaseModel):
    # Input is hidden from validation errors so a malformed user key never reaches a message or log.
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    proveedor: ProveedorId
    # A tier is resolved to a model by the catalog; an explicit model wins over the tier.
    modelo: NombreModelo | None = None
    nivel: Nivel | None = None
    temperatura: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=256, le=16384)
    api_key: SecretStr | None = Field(default=None, repr=False)
    base_url: HttpUrl | None = None

    @model_validator(mode="after")
    def _custom_endpoint_rules(self) -> Self:
        if self.modelo is None and self.nivel is None:
            raise ValueError("a selection needs a model or a tier")
        if self.proveedor == "openai_compatible":
            if self.base_url is None or self.api_key is None:
                raise ValueError("openai_compatible needs its own base_url and api_key")
        elif self.base_url is not None:
            raise ValueError("only openai_compatible accepts a user base_url")
        if self.api_key is not None and self.proveedor not in USER_KEY_PROVIDERS:
            raise ValueError(f"{self.proveedor} does not take an API key")
        return self

    @property
    def etiqueta(self) -> str:
        if self.modelo is None:
            raise ValueError("resolve the tier to a model before labelling the selection")
        return f"{self.proveedor}:{self.modelo}"

    @property
    def usa_clave_propia(self) -> bool:
        return self.api_key is not None


class SelectionError(ValueError):
    pass


def parse_selection(data: Mapping[str, object]) -> ProviderSelection:
    """Entry point for user-supplied selections; the error never holds the submitted values."""
    try:
        return ProviderSelection.model_validate(data)
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in issue['loc']) or 'selection'}: {issue['msg']}"
            for issue in error.errors(include_input=False, include_context=False, include_url=False)
        )
    # Raised outside the except block so the original ValidationError is not kept as __context__.
    raise SelectionError(problems)
