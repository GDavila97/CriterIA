import json
import re

from pydantic import BaseModel

_TAG = re.compile(r"^[a-z_]{1,40}$")
# JSON allows these escapes inside strings, so the payload stays lossless while no raw "<" or ">"
# can appear between the tags and close them early.
_ESCAPES = {"&": "\\u0026", "<": "\\u003c", ">": "\\u003e"}


def _escape(text: str) -> str:
    for character, escaped in _ESCAPES.items():
        text = text.replace(character, escaped)
    return text


def data_block(tag: str, payload: BaseModel | list[BaseModel] | str) -> str:
    if not _TAG.fullmatch(tag):
        raise ValueError(f"invalid data tag: {tag!r}")
    if isinstance(payload, BaseModel):
        plain: object = payload.model_dump(mode="json")
    elif isinstance(payload, list):
        plain = [item.model_dump(mode="json") for item in payload]
    else:
        plain = payload
    body = _escape(json.dumps(plain, ensure_ascii=False, indent=2))
    return f"<{tag}>\n{body}\n</{tag}>"
