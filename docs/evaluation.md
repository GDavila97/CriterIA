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

El modelo de generación de OpenAI para la evaluación es `gpt-6-luna` (nivel económico), y el modelo local es `llama3.1:8b` (ver la sección siguiente). Pendiente: correr `gpt-6-luna`, Claude Haiku (marcado por compartir proveedor con el juez), Groq y `llama3.1:8b`.

## Selección del modelo local

Prueba de selección hecha en F2b (5 nov 2026). No es la evaluación formal: son tres requerimientos de ejemplo por modelo, sin repeticiones, así que sirve para descartar configuraciones que no funcionan, no para medir diferencias finas de calidad.

### Método

- **Candidatos:** `qwen3:8b` (con el razonamiento apagado) y `llama3.1:8b`, ambos en Q4_K_M.
- **Casos:** los tres ejemplos de `services/api/examples/` (biblioteca, citas médicas y nómina), con `criteria run --auto-aprobar --json`, dos rondas de corrección como máximo, temperatura 0.2 y juez Claude Haiku (`claude-haiku-5-5`) con el juez v1.
- **Precarga:** antes de la primera corrida de cada modelo se hizo una llamada corta para que la carga no contara en la latencia, y se comprobó con `/api/ps` que el modelo estuviera al 100 % en la GPU.
- **Registro de validaciones:** las corridas se hicieron en proceso con un envoltorio del modelo que registra el motivo de cada reintento y los tokens reales de cada petición (`prompt_eval_count`).
- **Dos series:** primero con salida por herramienta (la predeterminada de Pydantic AI) y después con salida JSON nativa restringida al esquema ([ADR 0017](adr/0017-native-output-for-local-models.md)).

### Configuración de Ollama

Afecta la latencia, así que forma parte del resultado:

| Parámetro | Valor |
| --- | --- |
| Equipo | PC con NVIDIA RTX 4060 (8 GB de VRAM), en la red local |
| Ollama | 0.40.14 |
| `OLLAMA_CONTEXT_LENGTH` | 16384 |
| `OLLAMA_FLASH_ATTENTION` | 1 |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` |
| Carga en GPU | 100 % para los dos modelos (`qwen3:8b` 6.28 GB, `llama3.1:8b` 5.90 GB) |
| Razonamiento de `qwen3:8b` | apagado con `reasoning_effort: "none"` |

Con 16,384 tokens de contexto y la caché en `f16`, `qwen3:8b` solo cabía al 80 % en la GPU. Flash attention y la caché en `q8_0` lo dejaron al 100 % sin reducir el contexto. Un contexto de 8,192 tokens se descartó porque una ronda de corrección de QA puede acercarse a ese tamaño. La petición más grande medida fue de 6,652 tokens (40.6 % del contexto).

### Resultados

| Modo de salida | Modelo | Corridas completas | Salidas válidas a la primera | Latencia media (corridas completas) | Puntaje medio |
| --- | --- | --- | --- | --- | --- |
| nativa | `llama3.1:8b` | 3 de 3 | 25 de 26 (96 %) | 170 s | 2.17 |
| nativa | `qwen3:8b` | 2 de 3 | 24 de 25 (96 %) | 233 s | 2.25 |
| herramienta | `qwen3:8b` | 1 de 3 | 4 de 7 (57 %) | 70 s | 2.50 |
| herramienta | `llama3.1:8b` | 0 de 3 | 3 de 7 (43 %) | — | — |

Las salidas válidas a la primera cuentan las llamadas a Analista, QA y Revisor (el juez no es local). La latencia de las corridas completas no es comparable entre modos: con salida por herramienta, la única corrida completa no tuvo rondas de corrección. El puntaje medio es el promedio de los cuatro criterios del juez en las corridas completas, de 1 a 5, con un juez que pide severidad.

La única corrida fallida con salida nativa (`qwen3:8b`, biblioteca) no fue de validación. El QA de la segunda corrección agotó el tiempo: tres intentos de 60 s (`PROVIDER_TIMEOUT_SECONDS` más los dos reintentos internos del SDK de OpenAI), 181 s en total, y terminó con `proveedor_no_disponible`.

### Decisión

El modelo local de la evaluación es **`llama3.1:8b`** con salida nativa: completó las tres corridas, con el 96 % de salidas válidas a la primera, y fue el más rápido (170 s de media contra 233 s). En calidad, los dos modelos quedaron parejos: 2.17 contra 2.25, una diferencia que tres corridas no permiten distinguir. `qwen3:8b` se queda en el catálogo.

## Cómo reproducir

Pendiente: CLI de lote y CLI de calificación manual.

## Resultados v1

Pendiente.

## Comparación v1 contra v2

Pendiente: comparación pareada (Wilcoxon) con tamaño del efecto.

## Limitaciones

- La selección del modelo local usó tres requerimientos por modelo y una sola corrida de cada uno; no permite afirmar diferencias de calidad entre `llama3.1:8b` y `qwen3:8b`.
- La latencia local depende del equipo (RTX 4060 de 8 GB) y de la configuración de Ollama descrita arriba.

Pendiente: el resto de las limitaciones de la evaluación formal.
