import re
from pathlib import Path
from typing import Literal

RolAgente = Literal["analista", "qa", "revisor", "evaluador"]
_VERSION = re.compile(r"^v\d+$")


class PromptNotFoundError(FileNotFoundError):
    pass


def load_prompt(prompts_dir: Path, version: str, rol: RolAgente) -> str:
    if not _VERSION.fullmatch(version):
        raise ValueError(f"invalid prompt version: {version!r}")
    path = prompts_dir / version / f"{rol}.md"
    if not path.is_file():
        raise PromptNotFoundError(f"missing prompt {version}/{rol}.md")
    return path.read_text(encoding="utf-8").strip()
