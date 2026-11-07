"""Exports the HTTP bodies and the SSE events as one JSON Schema, the source of the web types."""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, RootModel
from pydantic.json_schema import GenerateJsonSchema, JsonSchemaMode, models_json_schema
from pydantic_core import CoreSchema, core_schema

from criteria.adapters.http import schemas
from criteria.config import SERVICE_ROOT
from criteria.domain.approval import RespuestaHumana
from criteria.domain.events import Evento as EventoUnion

CONTRACT_PATH = SERVICE_ROOT / "contract" / "schema.json"
DEFS_PREFIX = "#/$defs/"
REF_TEMPLATE = DEFS_PREFIX + "{model}"


class ContractSchema(GenerateJsonSchema):
    # Field titles would become one TypeScript alias per field (Id1, Tipo2...) in the web types.
    def field_title_should_be_set(self, schema: CoreSchema) -> bool:
        return False

    # Responses and events always carry every field, so the web can narrow on "type".
    def field_is_required(
        self,
        field: core_schema.ModelField | core_schema.DataclassField | core_schema.TypedDictField,
        total: bool,
    ) -> bool:
        return self.mode == "serialization" or super().field_is_required(field, total)


class Evento(RootModel[EventoUnion]):
    """Every SSE frame carries one of these in its data line."""


REQUESTS: tuple[type[BaseModel], ...] = (
    schemas.RunCreateBody,
    schemas.CredentialPutBody,
    schemas.SettingsBody,
    RespuestaHumana,
)
RESPONSES: tuple[type[BaseModel], ...] = (
    schemas.ErrorBody,
    schemas.HealthBody,
    schemas.RunCreatedBody,
    schemas.CredentialBody,
    schemas.SettingsBody,
    schemas.CatalogBody,
    schemas.HistorySummaryBody,
    schemas.HistoryItemBody,
    schemas.HistoryDeletedBody,
    schemas.EvaluationBody,
    schemas.UsageBody,
    schemas.AgentsBody,
)


def build_contract() -> dict[str, Any]:
    pairs: list[tuple[type[BaseModel], JsonSchemaMode]] = [
        *((model, "validation") for model in REQUESTS),
        *((model, "serialization") for model in RESPONSES),
        (Evento, "serialization"),
    ]
    # One pass, so a model whose input and output schemas differ gets two distinct names.
    _, generated = models_json_schema(
        pairs, ref_template=REF_TEMPLATE, schema_generator=ContractSchema
    )
    definitions = _plain_names(generated.get("$defs", {}))
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "CriteriaContract",
        "description": "HTTP bodies and SSE events of the CriterIA API.",
        "$defs": dict(sorted(definitions.items())),
    }


def _plain_name(name: str) -> str:
    """Pydantic splits a model as "X-Input"/"X-Output"; the web reads them as XInput and X."""
    return name.removesuffix("-Output").replace("-Input", "Input")


def _renamed(node: Any) -> Any:
    """Rewrites every reference, including the discriminator mappings."""
    if isinstance(node, dict):
        return {key: _renamed(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_renamed(item) for item in node]
    if isinstance(node, str) and node.startswith(DEFS_PREFIX):
        return REF_TEMPLATE.format(model=_plain_name(node.removeprefix(DEFS_PREFIX)))
    return node


def _plain_names(definitions: dict[str, Any]) -> dict[str, Any]:
    return {
        _plain_name(name): {**_renamed(schema), "title": _plain_name(name)}
        for name, schema in definitions.items()
    }


def render(contract: dict[str, Any]) -> str:
    return json.dumps(contract, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write or check the API JSON Schema contract.")
    parser.add_argument("--check", action="store_true", help="fail if the file is out of date")
    parser.add_argument("--path", type=Path, default=CONTRACT_PATH)
    args = parser.parse_args(argv)
    expected = render(build_contract())
    if args.check:
        current = args.path.read_text(encoding="utf-8") if args.path.exists() else ""
        if current != expected:
            print(f"{args.path} is out of date: run criteria-contract", file=sys.stderr)
            return 1
        print(f"{args.path} is up to date")
        return 0
    args.path.parent.mkdir(parents=True, exist_ok=True)
    args.path.write_text(expected, encoding="utf-8")
    print(f"wrote {args.path}")
    return 0


def run() -> None:
    sys.exit(main())
