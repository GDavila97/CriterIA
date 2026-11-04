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
