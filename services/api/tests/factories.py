from typing import Any

from criteria.domain.artifacts import CRITERIOS

REQUERIMIENTO = (
    "La biblioteca necesita que los socios reserven libros en línea y reciban un aviso "
    "cuando el libro esté disponible para recoger."
)


def historia(n: int = 1, **overrides: Any) -> dict[str, Any]:
    return {
        "id": f"HU-{n}",
        "como": "socio de la biblioteca",
        "quiero": f"reservar un libro (variante {n})",
        "para": "recogerlo cuando esté disponible",
        "prioridad": "alta",
        "supuestos": ["El socio ya tiene cuenta"],
        **overrides,
    }


def historias(count: int = 2) -> dict[str, Any]:
    return {"historias": [historia(n) for n in range(1, count + 1)]}


def caso(n: int = 1, historia_id: str = "HU-1", **overrides: Any) -> dict[str, Any]:
    return {
        "id": f"CP-{n:02d}",
        "historia_id": historia_id,
        "titulo": f"Reserva válida {n}",
        "pasos": ["Iniciar sesión", "Buscar el libro", "Pulsar reservar"],
        "resultado_esperado": "La reserva queda registrada",
        "gherkin": {
            "escenario": "Reserva de un libro disponible",
            "dado": ["un socio con sesión iniciada"],
            "cuando": ["reserva un libro"],
            "entonces": ["la reserva queda registrada"],
        },
        **overrides,
    }


def entrega_qa(casos: int = 2, historia_ids: tuple[str, ...] = ("HU-1",)) -> dict[str, Any]:
    return {
        "criterios": [
            {"id": f"CA-{i}", "historia_id": hid, "texto": "La reserva se confirma en pantalla"}
            for i, hid in enumerate(historia_ids, start=1)
        ],
        "casos": [caso(n, historia_ids[0]) for n in range(1, casos + 1)],
    }


def observacion(destino: str = "qa", **overrides: Any) -> dict[str, Any]:
    return {
        "tipo": "faltante",
        "destino": destino,
        "referencias": ["HU-1"],
        "descripcion": "No hay caso para un libro ya reservado",
        "sugerencia": "Agregar un caso de reserva duplicada",
        **overrides,
    }


def veredicto(*observaciones: dict[str, Any]) -> dict[str, Any]:
    return {"aprobado": not observaciones, "observaciones": list(observaciones)}


def evaluacion(valor: int = 4) -> dict[str, Any]:
    return {
        "puntajes": [
            {"criterio": c, "valor": valor, "justificacion": "Cumple con lo esperado"}
            for c in CRITERIOS
        ]
    }
