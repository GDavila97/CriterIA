"""The evaluation set and the batch results as versioned files, so results never need a database."""

import os
import re
import subprocess
import tempfile
import tomllib
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

from pydantic import BaseModel, ValidationError

from criteria.domain.evaluation import EvalBatch, EvalCase, HumanSession

CASES_PER_DIFFICULTY = 5


class EvalFileError(RuntimeError):
    pass


def load_cases(folder: Path, only: Sequence[str] = ()) -> list[EvalCase]:
    try:
        cases = [
            EvalCase.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))
            for path in sorted(folder.glob("*.toml"))
        ]
    except (tomllib.TOMLDecodeError, ValidationError) as error:
        raise EvalFileError(f"Invalid evaluation case: {error}") from error
    counts = Counter(case.dificultad for case in cases)
    if sorted(counts.values()) != [CASES_PER_DIFFICULTY] * 3:
        raise EvalFileError(f"The set needs 5 cases per difficulty, found {dict(counts)}")
    if not only:
        return cases
    unknown = sorted(set(only) - {case.id for case in cases})
    if unknown:
        raise EvalFileError(f"Unknown cases: {', '.join(unknown)}")
    return [case for case in cases if case.id in only]


def batch_slug(provider: str, model: str) -> str:
    return re.sub(r"[^a-z0-9.]+", "-", f"{provider}-{model}".lower()).strip("-")


def _write_atomically(path: Path, model: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(handle, "w", encoding="utf-8") as file:
        file.write(model.model_dump_json(indent=2) + "\n")
    Path(temporary).replace(path)


class JsonBatchStore:
    """One JSON file per batch; each save replaces it whole, so a cut never leaves half a file."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> EvalBatch | None:
        if not self.path.exists():
            return None
        return EvalBatch.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self, batch: EvalBatch) -> None:
        _write_atomically(self.path, batch)


class JsonSessionStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> HumanSession | None:
        if not self.path.exists():
            return None
        return HumanSession.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self, session: HumanSession) -> None:
        _write_atomically(self.path, session)


def load_batches(folder: Path) -> list[EvalBatch]:
    return [
        EvalBatch.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(folder.glob("*.json"))
        if path.name != "human.json"
    ]


def git_sha(root: Path) -> str:
    """The commit the batch ran on, marked when code, prompts or the catalog had local changes."""

    def git(*args: str) -> str:
        return subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    try:
        sha = git("rev-parse", "HEAD")
        dirty = git("status", "--porcelain", "--", "src", "prompts", "config")
    except (OSError, subprocess.CalledProcessError):
        return "desconocido"
    return f"{sha}+cambios-locales" if dirty else sha
