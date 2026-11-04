from criteria.domain.artifacts import (
    DestinoObservacion,
    EntregaQA,
    Esquema,
    HistoriaId,
    Historias,
    VeredictoRevisor,
)


class CambiosHistorias(Esquema):
    agregadas: list[HistoriaId]
    modificadas: list[HistoriaId]
    eliminadas: list[HistoriaId]

    def hay_cambios(self) -> bool:
        return bool(self.agregadas or self.modificadas or self.eliminadas)


def historias_desconocidas(entrega: EntregaQA, historias: Historias) -> list[str]:
    return sorted(entrega.historias_referidas() - historias.ids())


def referencias_desconocidas(
    veredicto: VeredictoRevisor, historias: Historias, entrega: EntregaQA
) -> list[str]:
    conocidas = historias.ids() | entrega.ids()
    referidas = {ref for observacion in veredicto.observaciones for ref in observacion.referencias}
    return sorted(referidas - conocidas)


def marcar_origen(nueva: EntregaQA, previa: EntregaQA | None) -> EntregaQA:
    """Cases the model returns are never trusted for their origin: first deliveries are QA's,
    and in a correction round only ids absent from the previous delivery come from the reviewer."""
    origen_previo = {caso.id: caso.origen for caso in previa.casos} if previa else {}
    casos = [
        caso.model_copy(
            update={"origen": origen_previo.get(caso.id, "revisor" if previa else "qa")}
        )
        for caso in nueva.casos
    ]
    return nueva.model_copy(update={"casos": casos})


def cambios_historias(previas: Historias, nuevas: Historias) -> CambiosHistorias:
    antes = {historia.id: historia for historia in previas.historias}
    despues = {historia.id: historia for historia in nuevas.historias}
    return CambiosHistorias(
        agregadas=sorted(despues.keys() - antes.keys()),
        modificadas=sorted(i for i in despues.keys() & antes.keys() if despues[i] != antes[i]),
        eliminadas=sorted(antes.keys() - despues.keys()),
    )


def destino_correccion(veredicto: VeredictoRevisor) -> DestinoObservacion:
    """Stories feed the test cases, so any observation on them reruns the Analyst first."""
    if any(observacion.destino == "analista" for observacion in veredicto.observaciones):
        return "analista"
    return "qa"
