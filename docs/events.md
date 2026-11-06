# Eventos de una corrida

Los eventos son modelos Pydantic (`services/api/src/criteria/domain/events.py`) que forman una unión discriminada por `type` ([ADR 0011](adr/0011-sse-typed-events.md)). La API los envía por SSE ([api.md](api.md#stream-sse)) y de ellos salen los tipos TypeScript de la web; la CLI los imprime (`--json` da un evento por línea).

## Campos comunes

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `type` | texto | Discriminador del evento |
| `run_id` | UUID | Corrida a la que pertenece |
| `seq` | entero ≥ 1 | Secuencia sin huecos dentro de la corrida; la asigna el `EventSink` y continúa tras la pausa humana |
| `ts` | fecha y hora con zona | Momento de emisión, tomado del `Clock` |
| `agent` | `analista`, `qa`, `revisor`, `evaluador` o `sistema` | Quién emite el evento |

## Tipos de evento

| `type` | `agent` | Campos propios |
| --- | --- | --- |
| `corrida_inicia` | `sistema` | `proveedor`, `modelos` (`generacion`, `juez`, como `proveedor:modelo`), `version_prompts` (agentes, `vN`), `version_juez` (Evaluador, `vN`), `juez_mismo_proveedor` (el juez es del mismo proveedor que la generación), `experimental`, `max_rondas` |
| `agente_inicia` | el agente | `ronda` |
| `agente_progreso` | el agente | `mensaje` (máximo 80 caracteres) |
| `agente_entrega` | el agente | `ronda`, `artefactos`, `uso` |
| `en_espera_humano` | `analista` | `solicitud` (`aprobar_historias`), `historias` |
| `humano_responde` | `analista` | `decision` (`aprobado` o `editado`), `cambios` (`agregadas`, `modificadas`, `eliminadas`: listas de ids) |
| `revisor_observa` | `revisor` | `ronda`, `observaciones`, `se_corrige` (falso cuando ya no quedan rondas) |
| `agente_error` | el agente | `codigo`, `mensaje` (seguro, máximo 200 caracteres), `respaldo_sugerido` |
| `corrida_fin` | `sistema` | `estado` (`completada` o `error`), `puntajes`, `totales`, `respaldo_sugerido` |

### `artefactos`

Unión discriminada por `tipo`, según el agente que entrega:

| `tipo` | Agente | Contenido |
| --- | --- | --- |
| `historias` | Analista | `historias` |
| `pruebas` | QA | `criterios`, `casos` (cada caso con `origen`: `qa` o `revisor`) |
| `revision` | Revisor | `veredicto` (`aprobado`, `observaciones`) |
| `puntajes` | Evaluador | `puntajes` |

### `uso` y `totales`

| Campo | Descripción |
| --- | --- |
| `tokens_entrada`, `tokens_salida` | Tokens reportados por el proveedor |
| `latencia_ms` | Tiempo de la llamada al agente, incluido el reintento |
| `costo_usd` | Costo con los precios de `config/models.toml`; `null` si falta el precio. En `totales` es `null` si falta en cualquier llamada |
| `reintentos` | Solo en `uso`: peticiones al modelo menos una |

### Códigos de `agente_error`

| Código | Cuándo |
| --- | --- |
| `salida_invalida` | La salida no cumplió el esquema ni con el reintento |
| `clave_invalida` | El proveedor rechazó la clave (401 o 403) |
| `sin_saldo` | La cuenta no tiene saldo o cuota (402, o el `insufficient_quota` que OpenAI envía con un 429) |
| `limite_proveedor` | El proveedor limitó la frecuencia de peticiones (429) |
| `proveedor_no_disponible` | Error del servidor del proveedor (5xx), de conexión o tiempo agotado |
| `destino_no_permitido` | La URL del usuario no pasó la protección SSRF o respondió demasiado |
| `error_interno` | Cualquier otro error |

## Secuencias típicas

Flujo feliz: `corrida_inicia` → (`agente_inicia`, `agente_progreso`, `agente_entrega`) del Analista → `en_espera_humano` → *pausa* → `humano_responde` → QA → Revisor → Evaluador → `corrida_fin`.

Con observaciones: después de la entrega del Revisor llega `revisor_observa`. Si `se_corrige` es verdadero, siguen el agente destino (y QA, si el destino fue el Analista) y otra revisión con la ronda aumentada.

Con error: `agente_error` del agente que falló y enseguida `corrida_fin` con `estado: "error"` y `puntajes` vacíos.

### Sin cambio de proveedor automático

Una corrida nunca pasa a otro proveedor por su cuenta: hacerlo enviaría los datos del usuario a un tercero que no eligió ([ADR 0016](adr/0016-claves-por-usuario.md)). Cuando el error es `clave_invalida`, `sin_saldo` o `limite_proveedor` y el proveedor que falló no es Groq, `agente_error` y `corrida_fin` llevan `respaldo_sugerido: "groq"`, para que la interfaz ofrezca "Usar el gratuito". En los demás casos el campo es `null`. El proveedor que cuenta es el del agente que falló, así que un fallo del juez sugiere según el proveedor del juez. No existe un evento `respaldo_activado`.

El nombre que se muestra en el globo de la oficina ("{nombre}, necesito tu visto bueno") se arma en el navegador y nunca viaja en los eventos.
