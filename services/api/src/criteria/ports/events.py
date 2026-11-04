from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from criteria.domain.events import EventoBase
from criteria.ports.clock import Clock


class EventSink(ABC):
    """Stamps each event of one run with the next seq and the clock time, then delivers it.

    `last_seq` lets a run resumed after the human pause continue the same sequence.
    """

    def __init__(self, run_id: UUID, clock: Clock, last_seq: int = 0) -> None:
        self.run_id = run_id
        self._clock = clock
        self._seq = last_seq

    @property
    def last_seq(self) -> int:
        return self._seq

    async def emit[E: EventoBase](self, kind: type[E], **fields: Any) -> E:
        self._seq += 1
        event = kind(run_id=self.run_id, seq=self._seq, ts=self._clock.now(), **fields)
        await self.deliver(event)
        return event

    @abstractmethod
    async def deliver(self, event: EventoBase) -> None: ...
