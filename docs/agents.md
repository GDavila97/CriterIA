# Agentes y grafo

CriterIA usa cuatro agentes de Pydantic AI ([ADR 0004](adr/0004-pydantic-ai-agents.md)) orquestados por un grafo de LangGraph ([ADR 0005](adr/0005-langgraph-orchestration.md)). Cada agente devuelve una salida tipada con los esquemas del dominio (`services/api/src/criteria/domain/artifacts.py`); una salida que no cumple el esquema nunca llega al siguiente agente.

## Los agentes

| Agente | Entrada | Salida (`output_type`) | Prompt |
| --- | --- | --- | --- |
| **Analista** | `<requerimiento>`; en una corrección, también `<historias>` y `<observaciones>` dirigidas a él | `Historias`: de 1 a 12 `HistoriaUsuario` (`HU-n`, como / quiero / para, prioridad, supuestos) | `prompts/v1/analista.md` |
| **QA** | `<historias>` aprobadas; en una corrección, también `<entrega_previa>` y `<observaciones>` | `EntregaQA`: criterios (`CA-n`) y casos de prueba (`CP-nn`) con pasos, resultado esperado y escenario Gherkin | `prompts/v1/qa.md` |
| **Revisor** | `<requerimiento>`, `<historias>`, `<entrega>` | `VeredictoRevisor`: `aprobado` y hasta 10 `Observacion` (tipo, destino, referencias, descripción, sugerencia) | `prompts/v1/revisor.md` |
| **Evaluador** | `<requerimiento>`, `<historias>`, `<entrega>`, `<observaciones_pendientes>` | `Evaluacion`: un `Puntaje` de 1 a 5 por criterio (claridad, verificabilidad, completitud, consistencia) con justificación de hasta 280 caracteres | `prompts/v1/evaluador.md` |

El Analista, QA y el Revisor usan el modelo de generación; el Evaluador usa el modelo del juez, que puede ser de otro proveedor.

### Reglas que el esquema no expresa

Se comprueban con validadores de salida de Pydantic AI, así que un incumplimiento consume el reintento como cualquier error de esquema:

- QA solo puede referirse a historias que existen, y cada historia necesita al menos un caso de prueba.
- El Revisor solo puede citar ids que existen (`HU-n`, `CA-n`, `CP-nn`).
- Un veredicto aprobado no lleva observaciones, y uno no aprobado lleva al menos una.
- Los ids son únicos dentro de cada lista.

### Datos, no instrucciones

El requerimiento y los artefactos llegan al prompt de usuario dentro de etiquetas (`<requerimiento>…</requerimiento>`, `<historias>…</historias>`), serializados como JSON. Los caracteres `<`, `>` y `&` se escriben como escapes JSON (`<`, `>`, `&`): el contenido no cambia, pero ningún texto puede cerrar la etiqueta. Esto vale también para lo que escribe una persona al editar historias y para lo que produjo otro agente. Cada prompt de sistema declara que lo que hay dentro de las etiquetas son datos y nunca instrucciones. Los agentes no tienen herramientas con efectos laterales.

### Origen de los casos

El origen de un caso (`qa` o `revisor`) no se toma de la salida del modelo:

- En la primera entrega de QA todos los casos son `qa`.
- En una corrección, los casos cuyo id no estaba en la entrega anterior son `revisor`, y los que ya existían conservan su origen.

## Grafo

```mermaid
flowchart TD
  start([inicio]) --> analista[Analista]
  analista -- error --> cierre
  analista -- ronda 0 --> solicitar[solicitar_aprobacion<br/>emite en_espera_humano]
  analista -- corrección --> qa
  solicitar --> aprobacion{{aprobacion<br/>interrupt}}
  aprobacion -- aprobado o editado --> qa[QA]
  qa -- error --> cierre
  qa --> revisor[Revisor]
  revisor -- error --> cierre
  revisor -- observaciones a historias y ronda < máximo --> analista
  revisor -- observaciones solo a pruebas y ronda < máximo --> qa
  revisor -- aprobado o tope de rondas --> evaluador[Evaluador]
  evaluador --> cierre[cierre<br/>emite corrida_fin]
  cierre --> fin([fin])
```

- **Pausa humana.** Después del Analista la corrida se detiene con `interrupt` y el estado queda en el checkpointer. La respuesta es `aprobado` o `editado` con historias validadas por el esquema; una edición inválida se rechaza antes de reanudar. `en_espera_humano` se emite en un nodo previo porque LangGraph vuelve a ejecutar desde el principio el nodo que llamó a `interrupt` cuando se reanuda.
- **Estado.** El estado del grafo solo guarda JSON (texto del requerimiento, artefactos, ronda, uso). Los agentes, la clave propia y el sink de eventos viajan en el contexto de ejecución de LangGraph, que no se guarda en el checkpoint.
- **Checkpointer.** En F2 es en memoria (`MemoryCheckpointer`). En F3 llega el de Postgres detrás del mismo puerto `Checkpointer`. Los checkpoints de una corrida se borran al terminar o al cancelarla.

## Política de reintentos

- Cada agente tiene **un reintento** de salida (`retries={"output": 1}`). Si la salida no cumple el esquema o una regla de coherencia, Pydantic AI le devuelve el error de validación al modelo y le pide otra salida.
- Si la segunda salida también falla, el nodo emite `agente_error` con código `salida_invalida` y un mensaje fijo. La corrida pasa a `cierre`, que emite `corrida_fin` con `estado: "error"`.
- Las fallas del proveedor se traducen a códigos seguros: `cuota_agotada` (429 o límite de cuota), `tiempo_agotado`, `proveedor_no_disponible`, `destino_no_permitido` (protección SSRF) y `error_interno`. El mensaje del evento nunca incluye texto del modelo, del proveedor ni datos internos, y el log solo registra el tipo de excepción.
- Los reintentos de cada llamada se reportan en `uso.reintentos` (peticiones al modelo menos una).

## Política de rondas

- El máximo de rondas de corrección es configurable (`MAX_REVIEW_ROUNDS`, 2 por defecto, de 0 a 5) y queda fijo en el estado de la corrida.
- Si el Revisor no aprueba y la ronda actual es menor que el máximo, la ronda aumenta en uno y el trabajo vuelve al destino:
  - Si alguna observación va al Analista, corrige él primero y luego QA rehace las pruebas, sin una segunda pausa humana.
  - Si todas van a QA, corrige solo QA.
- Con el máximo en 2 hay como mucho tres revisiones: la ronda 0 y dos correcciones.
- Al llegar al máximo, o cuando el Revisor aprueba, la corrida pasa al Evaluador. Las observaciones que no se corrigieron llegan al Evaluador como `<observaciones_pendientes>`, y `revisor_observa` lo indica con `se_corrige: false`.

## Proveedores

El registro (`adapters/llm/registry.py`) construye el modelo de Pydantic AI según la selección de la corrida (`ProviderSelection`: proveedor, modelo, temperatura, máximo de tokens y, solo para `openai_compatible`, URL base y clave propia).

- **Disponibilidad.** Un proveedor se ofrece solo si está configurado: clave del servidor para `openai`, `anthropic` y `groq`, y `OLLAMA_BASE_URL` para `ollama`. `openai_compatible` siempre está disponible porque usa la clave del usuario.
- **Modelos permitidos y precios.** Viven en `services/api/config/models.toml`, en USD por millón de tokens de entrada y de salida. Un modelo sin precio reporta costo `null`, y `corrida_fin` reporta costo `null` si cualquier llamada no lo tiene. `openai_compatible` acepta cualquier nombre de modelo con formato válido.
- **Clave propia.** Es un `SecretStr` que solo vive en la selección de la corrida. No aparece en `repr`, en errores de validación (`parse_selection` arma el mensaje sin los valores enviados), en logs, en eventos ni en checkpoints.
- **URL base del usuario** (`openai_compatible`):
  - Exige `https` y una URL sin credenciales.
  - No sigue redirecciones y aplica tiempo límite y tamaño máximo de respuesta.
  - Cada conexión resuelve el DNS, rechaza direcciones privadas, loopback, link-local, multicast y reservadas, `169.254.169.254` y sus equivalentes IPv6 (incluidas las IPv4 mapeadas, 6to4 y NAT64), y se conecta a la misma IP que validó. Después comprueba la dirección real del socket, lo que evita el rebinding de DNS.
- **Ollama.** La URL sale de la configuración del servidor, la pone el operador y puede ser privada. La protección SSRF no aplica a ella, solo a las URLs que envía el usuario.
