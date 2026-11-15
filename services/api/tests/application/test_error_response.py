import json
from datetime import UTC, datetime

from criteria.adapters.http.errors import error_response


def test_a_limit_says_when_it_frees_up_in_the_body_and_in_retry_after() -> None:
    response = error_response("limite_dia", datetime(2026, 11, 16, tzinfo=UTC))

    assert response.status_code == 429
    assert json.loads(bytes(response.body)) == {
        "code": "limite_dia",
        "message": "Alcanzaste el límite de análisis por día.",
        "retry_at": "2026-11-16T00:00:00Z",
    }
    assert response.headers["retry-after"] == "Mon, 16 Nov 2026 00:00:00 GMT"


def test_other_errors_carry_no_time() -> None:
    response = error_response("entrada_invalida")

    assert "retry_at" not in json.loads(bytes(response.body))
    assert "retry-after" not in response.headers
