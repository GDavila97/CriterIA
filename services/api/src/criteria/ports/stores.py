from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal, Protocol
from uuid import UUID

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import Nivel

RunStatus = Literal["creada", "en_curso", "esperando_aprobacion"]
KeySource = Literal["usuario", "servidor"]
LimitCode = Literal["limite_hora", "limite_dia", "cupo_gratuito_agotado", "limite_validaciones"]


@dataclass(frozen=True)
class UserSettings:
    save_history: bool = False
    default_provider: ProveedorId | None = None
    default_tier: Nivel | None = None
    judge_provider: ProveedorId | None = None


class SettingsStore(Protocol):
    async def get(self, user_id: str) -> UserSettings: ...

    async def put(self, user_id: str, settings: UserSettings) -> None: ...


@dataclass(frozen=True)
class ModelPlan:
    """What a run will call, without any secret: the key is looked up again when it runs."""

    proveedor: ProveedorId
    modelo: str
    temperatura: float
    max_tokens: int
    clave: KeySource


@dataclass(frozen=True)
class RunRecord:
    id: UUID
    user_id: str
    status: RunStatus
    requirement: str
    generation: ModelPlan
    judge: ModelPlan
    max_rounds: int
    server_cost_reserved_usd: float
    estimated_cost_usd: float | None
    created_at: datetime
    approval: dict[str, Any] | None = None


class StreamBusyError(Exception):
    pass


class RunStore(Protocol):
    async def create(self, record: RunRecord) -> None: ...

    async def get(self, run_id: UUID, user_id: str) -> RunRecord | None: ...

    async def set_status(self, run_id: UUID, status: RunStatus) -> None: ...

    async def set_approval(self, run_id: UUID, approval: dict[str, Any] | None) -> bool: ...

    async def append_event(
        self, run_id: UUID, seq: int, kind: str, payload: dict[str, Any]
    ) -> None: ...

    async def events_after(self, run_id: UUID, seq: int) -> list[dict[str, Any]]: ...

    async def last_seq(self, run_id: UUID) -> int: ...

    async def delete(self, run_id: UUID) -> None: ...

    async def stale(self, updated_before: datetime) -> list[UUID]: ...

    def stream_lock(self, run_id: UUID) -> AbstractAsyncContextManager[None]:
        """Held for the whole stream; raises StreamBusyError when another stream owns the run."""
        ...


@dataclass(frozen=True)
class UsageLimits:
    user_runs_per_hour: int
    user_runs_per_day: int
    global_daily_runs: int
    global_daily_budget_usd: float


class LimitExceededError(Exception):
    def __init__(self, codigo: LimitCode) -> None:
        super().__init__(codigo)
        self.codigo: LimitCode = codigo


class UsageGuard(Protocol):
    async def reserve(
        self, user_id: str, at: datetime, uses_server_key: bool, server_cost_usd: float
    ) -> None:
        """Atomically checks every limit and books the run; raises LimitExceededError."""
        ...

    async def settle(
        self, user_id: str, day: date, reserved_usd: float, actual_usd: float | None
    ) -> None:
        """Replaces the reserved server cost with the real one once the run ends."""
        ...


@dataclass(frozen=True)
class SavedRun:
    id: UUID
    status: str
    requirement: str
    artifacts: dict[str, Any]
    scores: list[dict[str, Any]]
    provider: str
    model: str
    judge_model: str
    prompt_version: str
    judge_version: str
    experimental: bool
    totals: dict[str, Any]
    created_at: datetime | None = None


@dataclass(frozen=True)
class SavedRunSummary:
    id: UUID
    status: str
    provider: str
    model: str
    created_at: datetime
    scores: list[dict[str, Any]] = field(default_factory=list)


class HistoryStore(Protocol):
    async def save(self, user_id: str, run: SavedRun) -> None: ...

    async def list(self, user_id: str, limit: int) -> list[SavedRunSummary]: ...

    async def get(self, user_id: str, run_id: UUID) -> SavedRun | None: ...

    async def delete_all(self, user_id: str) -> int: ...


class EvaluationReader(Protocol):
    async def batches(self) -> list[dict[str, Any]]: ...
