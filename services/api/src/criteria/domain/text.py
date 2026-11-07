import unicodedata
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

ALLOWED_CONTROL_CHARACTERS = frozenset({"\n", "\t"})
DISALLOWED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn"})


def reject_control_characters(value: str) -> str:
    for character in value:
        if character in ALLOWED_CONTROL_CHARACTERS:
            continue
        if unicodedata.category(character) in DISALLOWED_CATEGORIES:
            raise ValueError("contains control or non-printable characters")
    return value


_PRINTABLE = AfterValidator(reject_control_characters)

TextoCorto = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), _PRINTABLE
]
TextoMedio = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300), _PRINTABLE
]
TextoLargo = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400), _PRINTABLE
]
Justificacion = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=280), _PRINTABLE
]
NotaUsuario = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500), _PRINTABLE
]
TextoRequerimiento = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=20, max_length=2000), _PRINTABLE
]
