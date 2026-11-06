# 0004. Agentes con Pydantic AI

**Estado:** aceptada; ajustada por la [0015](0015-frozen-judge-prompt.md) (prompt del juez con versión propia) y por la [0017](0017-native-output-for-local-models.md) (salida JSON nativa para los modelos locales).

**Contexto:** las salidas de los agentes deben ser estructuradas y validadas, el proveedor debe cambiarse por configuración (incluido Ollama) y las pruebas no deben llamar a modelos reales.

**Decisión:** cada agente es un `Agent` de Pydantic AI con `output_type` tipado, prompt de sistema cargado desde `prompts/vN/<agente>.md` y dependencias inyectadas. Una salida inválida se reintenta una vez con el error de validación. Las pruebas usan los modelos simulados de Pydantic AI.

**Alternativas:** SDK de cada proveedor con parseo propio (duplica lógica por proveedor); LangChain (más abstracción de la necesaria para agentes sin herramientas).

**Consecuencias:** cambiar de modelo es configuración. La tasa de salidas válidas se vuelve una métrica directa de la evaluación.
