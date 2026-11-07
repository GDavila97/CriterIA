from typing import Protocol
from uuid import UUID

from langgraph.checkpoint.base import BaseCheckpointSaver


class Checkpointer(Protocol):
    """Keeps the graph state of a run across the human pause (memory in F2, Postgres in F3)."""

    def saver(self) -> BaseCheckpointSaver[str]: ...

    async def discard(self, run_id: UUID) -> None:
        """Deletes the checkpoints of a finished run; unsaved runs must not linger."""
        ...

    async def discard_orphans(self) -> int:
        """Deletes checkpoints whose run no longer exists, such as after an account deletion."""
        ...
