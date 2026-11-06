from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import SecretStr

from criteria.domain.events import ProveedorId
from criteria.ports.keys import KeyCheck


class FakeClock:
    """Advances one second per timestamp and a fixed step per latency reading."""

    def __init__(self, start: datetime | None = None, step_seconds: float = 0.25) -> None:
        self._now = start or datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
        self._monotonic = 0.0
        self._step = step_seconds

    def now(self) -> datetime:
        self._now += timedelta(seconds=1)
        return self._now

    def monotonic(self) -> float:
        self._monotonic += self._step
        return self._monotonic


class FakeKeyValidator:
    """Accepts any key except those containing "bad" or "down"; never touches the network."""

    def __init__(self) -> None:
        self.checked: list[ProveedorId] = []

    async def validate(
        self, proveedor: ProveedorId, api_key: SecretStr, base_url: str | None = None
    ) -> KeyCheck:
        self.checked.append(proveedor)
        key = api_key.get_secret_value()
        estado = "invalida" if "bad" in key else "no_verificable" if "down" in key else "valida"
        return KeyCheck(estado=estado, last4=key[-4:])  # type: ignore[arg-type]


class FakeReporter:
    def __init__(self) -> None:
        self.reported: list[tuple[BaseException, UUID]] = []

    def report(self, error: BaseException, run_id: UUID) -> None:
        self.reported.append((error, run_id))
