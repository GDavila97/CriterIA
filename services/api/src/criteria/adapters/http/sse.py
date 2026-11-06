from collections.abc import AsyncIterator

from criteria.domain.events import EventoBase

HEARTBEAT = b": ping\n\n"


def format_event(event: EventoBase) -> bytes:
    payload = event.model_dump_json()
    kind = getattr(event, "type", "evento")
    return f"id: {event.seq}\nevent: {kind}\ndata: {payload}\n\n".encode()


async def encode(events: AsyncIterator[EventoBase | None]) -> AsyncIterator[bytes]:
    async for event in events:
        yield HEARTBEAT if event is None else format_event(event)


def parse_last_event_id(value: str | None) -> int:
    """Ids are the event seq; anything else replays from the start."""
    if value is None or not value.strip().isdigit():
        return 0
    return int(value.strip())
