# Evaluación

Comparación de cuatro modelos sobre el mismo conjunto de requerimientos, con el mismo grafo y el mismo juez, más la validación del juez contra una calificación humana. Los números de la versión 1 están en [Resultados v1](#resultados-v1) y el reporte autocontenido en [evaluation/report-v1.md](evaluation/report-v1.md).

## Objetivo

Comparar modelos (API y local) y versiones de prompts con métricas reproducibles sobre el mismo conjunto de casos y el mismo juez, y saber cuánto se puede confiar en ese juez.

## Conjunto de casos

15 requerimientos en español escritos para la evaluación, en `services/api/eval/cases/*.toml`, sin datos reales de personas ni de instituciones y de 365 a 825 caracteres:

- 5 fáciles y 5 medios, de dominios variados: educación, comercio, salud administrativa, logística, finanzas, trámites de gobierno, recursos humanos y seguros.
- 5 difíciles con 5 problemas sembrados cada uno (25 en total): ambigüedades, inconsistencias y faltantes, del mismo tipo que las observaciones del Revisor. Los problemas viven en los metadatos del caso y nunca llegan a los agentes.

| Id | Título | Dominio |
| --- | --- | --- |
| facil-01 | Asistencia a talleres extracurriculares | educación |
| facil-02 | Lista de deseos de una tienda en línea | comercio |
| facil-03 | Recordatorios de citas de una clínica dental | salud administrativa |
| facil-04 | Rastreo de envíos por número de guía | logística |
| facil-05 | Registro de gastos personales | finanzas |
| medio-01 | Licencia de funcionamiento para comercios | trámites de gobierno |
| medio-02 | Inscripción a materias con cupo y prerrequisitos | educación |
| medio-03 | Solicitudes de vacaciones con aprobación | recursos humanos |
| medio-04 | Pedidos para recoger en una cadena de cafeterías | comercio |
| medio-05 | Reembolso de gastos médicos | seguros y salud administrativa |
| dificil-01 | Rutas de reparto de una distribuidora | logística |
| dificil-02 | Apoyo económico a pequeños productores | trámites de gobierno |
| dificil-03 | Préstamos de una caja de ahorro | finanzas |
| dificil-04 | Entrega y calificación de tareas | educación |
| dificil-05 | Programación de quirófanos de un hospital | salud administrativa |

## Método

- **Corridas.** `criteria eval run` corre el grafo completo de la app (Analista, pausa humana, QA, Revisor con hasta 2 rondas de corrección y Evaluador) con prompts v1 y juez v1, una corrida por caso y de forma secuencial.
- **Aprobación humana automática.** La pausa se responde aprobando las historias sin cambios, así que cada modelo trabaja con las historias de su propio Analista. Es parte del método: no hay una persona editando entre etapas.
- **Parámetros iguales para todos.** Temperatura pedida de 0.2 para los agentes y tope de 16,384 tokens por llamada (8,192 en Ollama; ver [Modelos comparados](#modelos-comparados)). Cada modelo usa el modo de salida de su entrada del catálogo (`tool` o `native`), que se muestra junto a su nombre en las tablas y en el tablero.
- **Parámetros que el proveedor ignora.** `claude-haiku-5-5` no acepta `temperature`. El juez y el emparejador (los dos con Haiku) corren con el muestreo predeterminado del modelo, igual que la generación del lote de Haiku. Cada lote guarda en `parametros_ignorados` lo que el proveedor descartó, y la [estabilidad](#estabilidad-del-juez-y-del-emparejador) mide qué tanto varía el juez por eso.
- **Errores.** Un error del modelo (salida inválida tras el reintento, tiempo agotado) es un resultado del lote. Un 429 espera 30, 60 y 120 s y repite el caso completo. Un error de cuenta (`clave_invalida`, `sin_saldo`, `cupo_gratuito_agotado`) o un 429 persistente detienen el lote sin registrar el caso, que se repite al reanudar.
- **Costo real.** Suma todo lo que se cobró, incluidas las llamadas que fallaron y los intentos repetidos tras un 429. El emparejador se cuenta aparte, como costo de análisis.
- **Registro y reproducibilidad.** Cada lote es un JSON versionado en `services/api/eval/results/v1/<proveedor>-<modelo>.json`, con proveedor, modelo, `display_name`, modo de salida, versiones de prompts y del juez, `git_sha`, temperatura, tope de tokens, fecha y, en Ollama, versión, contexto, flash attention, tipo de caché y porcentaje en GPU. Por caso guarda artefactos, salidas válidas a la primera por agente, reintentos, errores, rondas, latencia por agente y total, tokens, costo y puntajes del juez con su justificación. El lote se guarda después de cada caso y se reanuda con el mismo comando.

## Rúbrica

Puntaje de 1 a 5 por criterio, con una justificación breve:

- `claridad`: los artefactos se entienden sin ambigüedad.
- `verificabilidad`: los criterios y los casos se pueden comprobar con un resultado observable.
- `completitud`: el requerimiento queda cubierto por historias y cada historia por pruebas.
- `consistencia`: historias, criterios y casos concuerdan entre sí y con el requerimiento.

Escala: 1 deficiente, 2 con problemas graves, 3 aceptable con problemas, 4 bueno con detalles menores, 5 sin problemas relevantes. El puntaje global de una corrida es el promedio de sus cuatro criterios.

## Juez y su validación

El juez no cambia durante la evaluación. Su prompt vive en `services/api/prompts/juez/vN/evaluador.md` con una versión propia (`JUDGE_VERSION`), y cada corrida registra `version_prompts` y `version_juez` ([ADR 0015](adr/0015-frozen-judge-prompt.md)). Las mejoras v1 contra v2 solo tocan los prompts de los agentes, así que una diferencia de puntaje no puede venir de un juez distinto.

- **Juez.** `claude-haiku-5-5` con el juez v1 para los tres lotes, deliberadamente severo: un 5 es excepcional y, si duda entre dos valores, elige el menor. El lote de Haiku se marca con `*` porque el juez es de su mismo proveedor.
- **Calificación humana.** `criteria eval score` toma una muestra estratificada con semilla fija: 8 corridas repartidas lo más parejo posible entre los modelos (con tres modelos, 3, 3 y 2; la semilla decide cuál lleva 2), de dificultades distintas dentro de cada modelo; los 4 criterios de cada una, 32 pares. Es a ciegas: no muestra el modelo ni el puntaje del juez, y presenta los mismos artefactos y la misma rúbrica que recibió el juez.
- **Acuerdo.** Kappa de Cohen ponderada cuadrática, correlación de Spearman, acuerdo exacto y a ±1 punto, en total y por criterio, con intervalos al 95 % por bootstrap (2,000 remuestreos de los pares, semilla fija). La diferencia media juez menos humano dice si el juez califica más alto o más bajo.

### Estabilidad del juez y del emparejador

Como el juez no acepta temperatura, `criteria eval stability` le vuelve a pedir la calificación de 10 corridas elegidas con semilla fija, alternando modelos, y reporta su acuerdo consigo mismo: kappa ponderada y acuerdo exacto sobre los 40 pares. Lo mismo con el emparejador en los 5 casos difíciles de un lote elegido con la semilla (25 decisiones).

## Detección de problemas sembrados

En los 5 casos difíciles, un emparejador automático decide para cada problema sembrado si alguna observación del Revisor, en cualquier ronda, lo detectó y con cuál.

- **Emparejador.** `claude-haiku-5-5` con un prompt propio, versionado y congelado en `services/api/prompts/analisis/v1/emparejador.md`. Su salida es tipada: problema, detectado (sí o no), número de la observación que lo detecta y una justificación breve. Si duda, el problema no cuenta como detectado.
- **Fuera de la corrida.** No participa en las corridas ni en la rúbrica: es análisis posterior sobre los lotes ya guardados (`criteria eval match`). Solo se emparejan las corridas difíciles completas.
- **Validación.** En la misma sesión humana se revisan 10 emparejamientos elegidos con semilla fija, a ciegas sobre el modelo, y se reporta qué proporción confirmó la persona.
- **Métrica.** Tasa de detección por modelo, en total y por tipo, siempre con su denominador, y la lista de problemas que ningún modelo detectó entre los que completaron cada caso. Un modelo que no completó los 5 casos difíciles tiene una tasa sobre menos casos: se marca como no directamente comparable, y una columna aparte compara a todos sobre los casos difíciles que todos completaron.

## Comparación sobre los casos comunes

Un modelo con corridas fallidas promedia sobre menos casos, y no siempre los mismos. Por eso, además del promedio general (todas sus corridas completas), el reporte y el tablero dan el puntaje de cada modelo sobre los casos que todos los modelos de la misma versión completaron y el juez calificó. El tablero destaca el mejor puntaje sobre esos casos comunes.

## Modelos comparados

| Modelo | Modo de salida | Tope de tokens | Nota |
| --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (`claude-haiku-5-5`) | `tool` | 16,384 | El juez es del mismo proveedor (`*`) |
| Groq · GPT-OSS 20B (`openai/gpt-oss-20b`) | `native` | 16,384 | Modelo del modo gratuito en producción |
| Ollama · Llama 3.1 8B (`llama3.1:8b`) | `native` | 8,192 | Local, RTX 4060; ver [la selección](#selección-del-modelo-local) |

**Cambio de alcance.** El plan incluía OpenAI `gpt-6-luna`, pero su lote se detuvo en el primer caso con `sin_saldo`: el crédito de la cuenta venció. La evaluación v1 queda con tres modelos. OpenAI se probará en producción con la clave de cada usuario, y el catálogo conserva sus modelos.

**Tope de tokens por modelo.** Los modelos por API usan 16,384, el valor por defecto de la app. Ollama usa 8,192 (`max_tokens` en su entrada de `models.toml`) porque su contexto es de 16,384 y una petición grande (6,652 tokens medidos) más 16,384 de salida no caben. Es la única diferencia de configuración entre lotes, y queda registrada en cada uno.

**Tiempo límite.** Cada proveedor usa el tiempo límite de la app: 60 s por llamada para los modelos por API y 180 s para Ollama (`PROVIDER_TIMEOUTS=ollama:180`).

**Reanudaciones.** El lote de Ollama se detuvo en el segundo caso porque la cuenta de Anthropic del juez se quedó sin saldo; el caso no se registró y el lote se reanudó tras la recarga. Al reanudar, el código había avanzado de `f5e5b9a` a `ec270c4`, un commit que solo cambió la muestra de la calificación humana y la documentación, no el camino de una corrida. El lote conserva el SHA con el que empezó.

## Hallazgos de integración antes de los lotes v1

Ninguno cambió los prompts; todos cambiaron cómo se llama al modelo, y los lotes afectados se repitieron completos.

- **gpt-oss-20b con salida por herramienta.** En el primer intento, 0 de 7 corridas completas y 0 de 8 llamadas válidas a la primera. En el reintento, el modelo producía la salida correcta pero llamaba a la herramienta `functions.final_result` en lugar de `final_result`, y Pydantic AI la descartaba como herramienta desconocida; otras veces Groq rechazaba la llamada mal formada con un 400. Con salida JSON nativa, 3 de 3 salidas fueron válidas a la primera ([ADR 0021](adr/0021-native-output-for-gpt-oss-on-groq.md)).
- **Rechazos del esquema en Groq.** Con salida nativa, Groq valida el JSON en su servidor y rechaza con un 400 (`json_validate_failed`) la salida que no cumple. Ahora cuenta como salida inválida y tiene el mismo reintento único que los demás modelos.
- **Tope de 4,096 y de 8,192 tokens.** Los tokens de razonamiento de gpt-oss cuentan dentro del tope. Con 4,096, el Revisor salió bien 1 de 4 veces; con 8,192, Groq siguió rechazando salidas vacías. Al repetir la misma petición sin esquema, 3 de 6 respuestas terminaron con `finish_reason=length`, 8,190 tokens de razonamiento y contenido vacío: los rechazos eran por longitud. Con 16,384 bajaron de 4 de 6 a 1 de 6, y esa también fue por longitud (16,382 tokens de razonamiento). En Haiku, el primer lote con 8,192 completó 7 de 15 corridas: sus entregas de QA en las rondas de corrección promediaban de 7,400 a 8,100 tokens por petición y el JSON se cortaba.
- **Tiempo límite de Ollama más corto que su tope de tokens.** En el lote v1, 4 de 15 corridas de `llama3.1:8b` terminaron con `proveedor_no_disponible` por tiempo agotado: 3 en QA y 1 en el Analista. En las corridas completas el modelo generó a unos 40 tokens por segundo (16,706 tokens de QA en 414 s), así que una llamada de más de unos 7,000 tokens no cabe en 180 s aunque el tope sea 8,192. El fallo del Analista sugiere un bucle de repetición: suele responder en unos 20 s con unos 500 tokens. Una llamada cortada por tiempo no devuelve uso, así que no se sabe cuántos tokens llevaba ni si habría terminado bien. Se aceptaron las 11 corridas completas como resultado v1, porque el método trata un tiempo agotado como un resultado y 180 s es la configuración de la app; alinear el tiempo límite con el tope queda como mejora candidata para v2.
- **Costo de las llamadas fallidas.** Antes no se sumaba (el evento de error no llevaba uso), así que el costo de un lote con errores salía en cero. Ahora cuenta en los totales, en la reserva del tope global y en los lotes. Los rechazos de Groq no devuelven uso, así que su costo no se puede medir; el de un lote de Groq es un mínimo.

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

Desde `services/api`, con las claves en el `.env` local y los proveedores en `SERVER_KEY_PROVIDERS`:

```bash
uv run criteria eval run --provider openai --model gpt-6-luna
uv run criteria eval run --provider anthropic --model claude-haiku-5-5
uv run criteria eval run --provider groq --model openai/gpt-oss-20b
uv run criteria eval run --provider ollama --model llama3.1:8b \
  --ollama-context 16384 --ollama-flash-attention 1 --ollama-kv-cache q8_0
uv run criteria eval match        # emparejador de problemas sembrados
uv run criteria eval stability    # el juez y el emparejador contra sí mismos
uv run criteria eval score        # calificación humana a ciegas, pausable con p
uv run criteria eval report       # tablas.md, reporte.json y la gráfica
uv run criteria eval publish --file eval/results/v1/<lote>.json   # rol eval_writer
uv run criteria eval publish --human
```

Todos los comandos se reanudan donde se quedaron. `publish` es idempotente: los ids de las filas se derivan del lote y del caso.

## Resultados v1

Pendiente.

## Comparación v1 contra v2

Pendiente: comparación pareada (Wilcoxon) con tamaño del efecto. Se hará solo con Haiku y GPT-OSS 20B: el modelo local completó 11 de 15 casos en v1 y su tiempo límite corta salidas largas, así que no aporta una base pareada estable.

## Limitaciones

- La selección del modelo local usó tres requerimientos por modelo y una sola corrida de cada uno; no permite afirmar diferencias de calidad entre `llama3.1:8b` y `qwen3:8b`.
- La latencia local depende del equipo (RTX 4060 de 8 GB) y de la configuración de Ollama descrita arriba.

Pendiente: el resto de las limitaciones de la evaluación formal.
