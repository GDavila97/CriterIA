from criteria.adapters.http.errors import MESSAGES
from criteria.application.run_api import INTERNAL_ERROR_MESSAGE


def test_messages_people_read_say_analisis_and_never_corrida() -> None:
    texts = [*MESSAGES.values(), INTERNAL_ERROR_MESSAGE]

    assert not [text for text in texts if "corrida" in text.lower()]
    assert MESSAGES["limite_hora"] == "Alcanzaste el límite de análisis por hora."
    assert MESSAGES["stream_activo"] == "Este análisis ya está abierto en otra pestaña."
    assert INTERNAL_ERROR_MESSAGE == "El análisis se detuvo por un error interno. Intenta de nuevo."
