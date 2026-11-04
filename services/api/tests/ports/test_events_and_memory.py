from uuid import uuid4

from langgraph.checkpoint.base import empty_checkpoint

from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.adapters.memory.events import ListEventSink
from criteria.adapters.system_clock import SystemClock
from criteria.domain.events import AgenteInicia, AgenteProgreso
from tests.fakes import FakeClock


async def test_sink_assigns_increasing_seq_and_clock_time_per_run() -> None:
    run_id = uuid4()
    sink = ListEventSink(run_id, FakeClock())

    first = await sink.emit(AgenteInicia, agent="analista", ronda=0)
    second = await sink.emit(AgenteProgreso, agent="analista", mensaje="Redactando historias")

    assert [event.seq for event in sink.events] == [1, 2]
    assert first.run_id == second.run_id == run_id
    assert second.ts > first.ts
    assert sink.last_seq == 2


async def test_resumed_sink_continues_the_sequence() -> None:
    sink = ListEventSink(uuid4(), FakeClock(), last_seq=4)

    event = await sink.emit(AgenteInicia, agent="qa", ronda=0)

    assert event.seq == 5


async def test_memory_checkpointer_discards_a_finished_run() -> None:
    checkpointer = MemoryCheckpointer()
    run_id = uuid4()
    config = {"configurable": {"thread_id": str(run_id), "checkpoint_ns": ""}}
    await checkpointer.saver().aput(config, empty_checkpoint(), {}, {})  # type: ignore[arg-type]
    assert await checkpointer.saver().aget_tuple(config) is not None  # type: ignore[arg-type]

    await checkpointer.discard(run_id)

    assert await checkpointer.saver().aget_tuple(config) is None  # type: ignore[arg-type]


def test_system_clock_is_timezone_aware_and_monotonic() -> None:
    clock = SystemClock()

    assert clock.now().tzinfo is not None
    assert clock.monotonic() <= clock.monotonic()
