from uuid import UUID

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver


class MemoryCheckpointer:
    def __init__(self) -> None:
        self._saver = InMemorySaver()

    def saver(self) -> BaseCheckpointSaver[str]:
        return self._saver

    async def discard(self, run_id: UUID) -> None:
        await self._saver.adelete_thread(str(run_id))

    async def discard_orphans(self) -> int:
        # Runs only live in this process, so nothing outlives them.
        return 0
