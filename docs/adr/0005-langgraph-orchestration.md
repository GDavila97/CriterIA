# 0005. Orquestación con LangGraph

**Estado:** aceptada.

**Contexto:** el flujo tiene un ciclo (Revisor que devuelve trabajo), una pausa humana entre peticiones y un límite de rondas. Se necesita un flujo determinista para que la evaluación sea comparable.

**Decisión:** un `StateGraph` de LangGraph con nodos Analista, aprobación humana (`interrupt`), QA, Revisor y Evaluador; arista condicional del Revisor según observaciones y ronda (máximo configurable, 2 por defecto). Checkpointer de Postgres en el esquema `graph`. Cada nodo llama a su agente de Pydantic AI y emite eventos.

**Alternativas:** máquina de estados propia (más simple, pero hay que construir checkpoints e interrupciones); CrewAI (más autonomía y menos control, contrario a la evaluación reproducible).

**Consecuencias:** la pausa humana sobrevive entre peticiones e instancias. Se agrega una dependencia relevante que hay que mantener al día.
