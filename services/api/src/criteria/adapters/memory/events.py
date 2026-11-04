from uuid import UUID

from criteria.domain.events import EventoBase
from criteria.ports.clock import Clock
from criteria.ports.events import EventSink


class ListEventSink(EventSink):
    """Keeps every event in memory; used by tests and as a buffer for batch runs."""

    def __init__(self, run_id: UUID, clock: Clock, last_seq: int = 0) -> None:
        super().__init__(run_id, clock, last_seq)
        self.events: list[EventoBase] = []

    async def deliver(self, event: EventoBase) -> None:
        self.events.append(event)
