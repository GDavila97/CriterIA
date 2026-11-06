from typing import Protocol
from uuid import UUID


class ErrorReporter(Protocol):
    """Sends an unexpected failure to monitoring without the user's data."""

    def report(self, error: BaseException, run_id: UUID) -> None: ...
