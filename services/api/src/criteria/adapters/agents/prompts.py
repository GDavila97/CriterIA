import re
from pathlib import Path
from typing import Literal

RolAgente = Literal["analista", "qa", "revisor", "evaluador"]
_VERSION = re.compile(r"^v\d+$")
# The judge has its own versions so improving the agents never changes how they are scored.
JUDGE_DIR = "juez"


class PromptNotFoundError(FileNotFoundError):
    pass


def load_prompt(prompts_dir: Path, version: str, rol: RolAgente) -> str:
    if not _VERSION.fullmatch(version):
        raise ValueError(f"invalid prompt version: {version!r}")
    folder = prompts_dir / JUDGE_DIR / version if rol == "evaluador" else prompts_dir / version
    path = folder / f"{rol}.md"
    if not path.is_file():
        raise PromptNotFoundError(f"missing prompt {path.relative_to(prompts_dir)}")
    return path.read_text(encoding="utf-8").strip()
