from pathlib import Path

import pytest

from criteria.adapters.http.contract import CONTRACT_PATH, build_contract, main, render


def test_the_versioned_contract_is_up_to_date() -> None:
    assert CONTRACT_PATH.read_text(encoding="utf-8") == render(build_contract())


def test_the_contract_names_every_body_and_event() -> None:
    definitions = build_contract()["$defs"]

    for name in ("RunCreateBody", "RunCreatedBody", "RespuestaHumana", "ErrorBody", "Evento"):
        assert name in definitions
    assert set(definitions["Evento"]["discriminator"]["mapping"]) >= {
        "corrida_inicia",
        "en_espera_humano",
        "corrida_fin",
    }


def test_check_fails_on_a_stale_file_and_write_fixes_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    target = tmp_path / "contract" / "schema.json"

    assert main(["--check", "--path", str(target)]) == 1
    assert main(["--path", str(target)]) == 0
    assert main(["--check", "--path", str(target)]) == 0
    assert "out of date" in capsys.readouterr().err
