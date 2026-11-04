# Evaluación

> Esqueleto. Se completa en F5 con el lote v1 y en F8 con la comparación v1 contra v2.

## Objetivo

Comparar modelos (API y local) y versiones de prompts con métricas reproducibles sobre el mismo conjunto de casos y el mismo juez.

## Conjunto de casos

Pendiente: 15 requerimientos (5 fáciles, 5 medios y 5 difíciles con ambigüedades sembradas).

## Rúbrica

Pendiente: puntaje de 1 a 5 por criterio (claridad, verificabilidad, completitud y consistencia), con justificación breve.

## Juez y su validación

El juez no cambia durante la evaluación. Su prompt vive en `services/api/prompts/juez/vN/evaluador.md` con una versión propia (`JUDGE_VERSION`), y cada corrida registra `version_prompts` y `version_juez` ([ADR 0015](adr/0015-frozen-judge-prompt.md)). Las mejoras v1 contra v2 solo tocan los prompts de los agentes, así que una diferencia de puntaje no puede venir de un juez distinto. Los resultados solo se comparan entre corridas con la misma `version_juez`.

El juez v1 es deliberadamente severo: un 5 es excepcional y, si duda entre dos valores, elige el menor.

Pendiente: Claude Haiku a temperatura 0 con salida tipada. Validación contra una muestra calificada a mano (unos 30 pares caso-criterio) con kappa de Cohen ponderado (cuadrático) y correlación de Spearman.

## Métricas

Pendiente: puntaje por criterio, tasa de salidas válidas, rondas de revisión, latencia p50 y p95, tokens y costo por corrida.

## Modelos comparados

Pendiente: OpenAI mini, Claude Haiku (marcado por compartir proveedor con el juez), Groq y el modelo local.

## Cómo reproducir

Pendiente: CLI de lote y CLI de calificación manual.

## Resultados v1

Pendiente.

## Comparación v1 contra v2

Pendiente: comparación pareada (Wilcoxon) con tamaño del efecto.

## Limitaciones

Pendiente.
