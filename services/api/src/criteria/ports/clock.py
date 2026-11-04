from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime:
        """Timezone-aware wall-clock time used for event timestamps."""
        ...

    def monotonic(self) -> float:
        """Seconds from an arbitrary origin, used only to measure latency."""
        ...
