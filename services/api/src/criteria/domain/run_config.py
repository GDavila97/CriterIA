from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    SecretStr,
    StringConstraints,
    model_validator,
)

from criteria.domain.events import ProveedorId

NombreModelo = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$")]


class ProviderSelection(BaseModel):
    # Input is hidden from validation errors so a malformed user key never reaches a message or log.
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    proveedor: ProveedorId
    modelo: NombreModelo
    temperatura: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=256, le=16384)
    api_key: SecretStr | None = Field(default=None, repr=False)
    base_url: HttpUrl | None = None

    @model_validator(mode="after")
    def _custom_endpoint_rules(self) -> Self:
        if self.proveedor == "openai_compatible":
            if self.base_url is None or self.api_key is None:
                raise ValueError("openai_compatible needs its own base_url and api_key")
        elif self.base_url is not None:
            raise ValueError("only openai_compatible accepts a custom base_url")
        return self

    @property
    def etiqueta(self) -> str:
        return f"{self.proveedor}:{self.modelo}"

    @property
    def usa_clave_propia(self) -> bool:
        return self.api_key is not None
