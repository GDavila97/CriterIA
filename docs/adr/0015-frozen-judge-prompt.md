# 0015. Juez con versión propia y congelado

**Estado:** aceptada (4 nov 2026). Ajusta la [0004](0004-pydantic-ai-agents.md) y agrega un campo a los eventos de la [0011](0011-sse-typed-events.md).

**Contexto:** la 0004 cargaba todos los prompts de `prompts/vN/<agente>.md` con una sola versión. La evaluación compara v1 contra v2 de los agentes con los mismos casos y el mismo juez. Si el prompt del Evaluador cambiara junto con el de los agentes, una mejora en el puntaje podría deberse a un juez más indulgente y no a mejores artefactos.

**Decisión:**

- El prompt del Evaluador vive en `prompts/juez/vN/evaluador.md` y tiene su propia versión (`JUDGE_VERSION`), separada de la de Analista, QA y Revisor (`PROMPT_VERSION`).
- Las dos versiones quedan registradas en cada corrida: `corrida_inicia` lleva `version_prompts` y `version_juez`.
- El juez no cambia durante la evaluación: las mejoras v1 contra v2 solo tocan `prompts/vN/` de los agentes. Cambiar el juez exige una versión nueva de `prompts/juez/` y repetir la línea base.
- El juez v1 pide severidad explícita: un 5 es excepcional y, si duda entre dos valores, elige el menor.

**Alternativas:** una sola versión para todos los prompts (más simple, pero mezcla la mejora de los agentes con cambios del juez); congelar el juez por convención sin separarlo (fácil de romper sin que nadie lo note).

**Consecuencias:** los resultados de evaluación se comparan solo entre corridas con la misma `version_juez`. Cambiar la rúbrica es una decisión visible que invalida las comparaciones anteriores.
