# API HTTP

Contrato de la API de CriterIA desde F3. Los cuerpos y los eventos están definidos en Pydantic y se exportan como JSON Schema a [services/api/contract/schema.json](../services/api/contract/schema.json); la web genera sus tipos desde ese archivo con `pnpm gen:api` (ver [Contrato](#contrato)).

Fuera de producción, el esquema OpenAPI está en `/openapi.json` y la documentación interactiva en `/docs`.

## Autenticación

- Todas las rutas, salvo `GET /health` y `GET /evaluation`, exigen `Authorization: Bearer <jwt>`.
- El JWT lo emite la web (Better Auth) y dura cinco minutos ([ADR 0008](adr/0008-better-auth-and-api-jwt.md)). La API lo verifica con el JWKS de la web (`AUTH_JWKS_URL`): firma con un algoritmo asimétrico de `AUTH_ALGORITHMS` (EdDSA por defecto), `kid` presente en el JWKS, y `iss`, `aud`, `exp` y `sub` obligatorios, con `AUTH_LEEWAY_SECONDS` de tolerancia. Un `kid` desconocido fuerza una recarga del JWKS, como mucho una cada 30 s.
- `sub` es el `user_id`, el `id` de `auth."user"`. Crear corridas y guardar claves exige además que el claim `AUTH_VERIFIED_CLAIM` (`email_verified`) sea `true`; Better Auth lo incluye en el payload del JWT. Mientras la web no pueda enviar correos (`EMAIL_PROVIDER=none`), `AUTH_REQUIRE_VERIFIED_EMAIL=false` desactiva esa exigencia ([ADR 0020](adr/0020-github-first-sign-in-without-email.md)).
- Las claves de proveedor nunca viajan en cabeceras: solo en el cuerpo de `PUT /me/credentials/{provider}`.
- Un token ausente, vencido o inválido recibe siempre el mismo `401` con `WWW-Authenticate: Bearer`.

## Endpoints

| Método y ruta | Auth | Respuesta | Qué hace |
| --- | --- | --- | --- |
| `GET /health` | — | `200 HealthBody` | Estado y versión; no toca la base. No es `/healthz` porque Cloud Run reserva rutas que terminan en `z` ([deploy.md](deploy.md)) |
| `POST /runs` | verificado | `201 RunCreatedBody` | Valida, resuelve proveedor, modelo y clave, reserva el cupo y guarda la corrida. No llama a ningún modelo |
| `GET /runs/{id}/stream` | verificado | `200 text/event-stream` | Ejecuta la corrida desde su último checkpoint y emite los eventos hasta la pausa humana o el final ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)) |
| `POST /runs/{id}/approval` | verificado | `204` | Guarda la respuesta humana (`RespuestaHumana`); el siguiente stream reanuda con ella |
| `PUT /me/credentials/{provider}` | verificado | `200 CredentialBody` | Valida la clave con el proveedor y la guarda cifrada |
| `GET /me/credentials` | sesión | `200 CredentialBody[]` | Proveedores con clave propia, con sus últimos 4 caracteres |
| `DELETE /me/credentials/{provider}` | sesión | `204` | Borra la clave; `404` si no había |
| `GET /me/settings` / `PUT /me/settings` | sesión | `200 SettingsBody` | Historial activado, proveedor, nivel y juez por defecto |
| `GET /catalog` | sesión | `200 CatalogBody` | Proveedores, disponibilidad y origen de la clave, niveles con modelo, nombre legible (`display_name`) y costo estimado, nombre legible de cada modelo (`display_names`), costo de la generación por modelo (`costos_generacion`) y del Evaluador en el nivel económico (`costo_juez_usd`), proveedor y juez por defecto |
| `GET /agents` | sesión | `200 AgentsBody` | Prompts de sistema de los cuatro agentes con su versión (solo lectura) y los rangos de los parámetros por agente |
| `GET /me/usage` | sesión | `200 UsageBody` | Corridas iniciadas en la última hora y en el día, con sus límites |
| `GET /me/runs` | sesión | `200 HistorySummaryBody[]` | Historial guardado (solo si `save_history` estaba activo al terminar), con el nombre legible del modelo (`model_display_name`) |
| `GET /me/runs/{id}` | sesión | `200 HistoryItemBody` | Una corrida guardada con artefactos, puntajes, versiones, totales y nombres legibles del modelo y del juez (`model_display_name`, `judge_display_name`) |
| `DELETE /me/runs` | sesión | `200 HistoryDeletedBody` | Borra todo el historial del usuario |
| `GET /evaluation` | — | `200 EvaluationBody` | Lotes de evaluación agregados (validez, latencia p50 y p95, costo medio, nombre legible del modelo); `Cache-Control: public, max-age=60` |

"Sesión" es un JWT válido; "verificado" exige además el correo verificado. Una corrida o una clave de otro usuario responde `404`, igual que una inexistente.

### `POST /runs`

```json
{
  "requerimiento": "texto de 20 a 2,000 caracteres",
  "proveedor": "groq",
  "nivel": "economico",
  "juez": "groq",
  "max_rondas": 2,
  "guardar_historial": false,
  "agentes": { "qa": { "modelo": "openai/gpt-oss-20b", "temperatura": 0.4, "max_tokens": 16384 } }
}
```

Todo es opcional salvo `requerimiento`. `max_rondas` va de 0 a 3.

- `agentes` ajusta a cada agente por separado: `nivel` o `modelo` (de la lista permitida), `temperatura` de 0 a 1 y `max_tokens` de 256 a 16,384 (los modelos locales lo bajan a 8,192). El modelo se elige solo dentro del proveedor de su grupo: Analista, QA y Revisor usan el de generación y el Evaluador el del juez, así que el aviso de proveedor sigue siendo exacto. Lo que no se ajusta toma el valor de la corrida.
- `guardar_historial` decide si esa corrida se copia al historial al terminar. Sin él se usa el ajuste "Guardar mis corridas" de la cuenta. Queda fijo al crear la corrida: cambiar el ajuste después no la afecta.
- El costo estimado suma el de cada agente con su propio modelo, y `costo_servidor_usd` solo el de los agentes que usan la clave del servidor. Sin `proveedor` se usa el de los ajustes y, si no hay, el del servidor. `modelo` gana sobre `nivel`. Sin `juez` se usa el de los ajustes o, si no, `elegir_juez` sobre los proveedores disponibles para el usuario ([ADR 0016](adr/0016-claves-por-usuario.md)).

La clave sale de la clave propia del usuario para ese proveedor; si no tiene, de la del servidor cuando el proveedor está en `SERVER_KEY_PROVIDERS`; si tampoco, `422 clave_requerida`. La respuesta dice qué clave usará cada parte (`"usuario"` o `"servidor"`), el costo estimado total y la parte que paga el servidor (`costo_servidor_usd`), que es lo que se reserva del cupo global.

### Aprobación

`POST /runs/{id}/approval` acepta:

- `{"decision": "aprobado"}`
- `{"decision": "editado", "historias": {...}}`
- `{"decision": "otra_version", "nota": "texto opcional de hasta 500 caracteres"}`: el Analista vuelve a redactar las historias y la corrida pausa de nuevo. La nota llega al modelo como dato, dentro de `<nota_usuario>` y con el mismo escape que el requerimiento, así que no puede cerrar la etiqueta. Se puede pedir dos veces por corrida; la tercera responde `409 versiones_agotadas`. No consume otra corrida del cupo, pero el costo estimado de la llamada extra se reserva del tope global en dólares (si no cabe, `429 cupo_gratuito_agotado`) y al terminar se ajusta al real.

Solo vale mientras la corrida está en `esperando_aprobacion`; si no, `409 estado_invalido`. La corrida pasa a ese estado antes de que el cliente reciba `en_espera_humano`, así que se puede aprobar en cuanto llega el evento.

## Stream SSE

```
id: 7
event: agente_entrega
data: {"type":"agente_entrega","run_id":"…","seq":7,…}

: ping
```

- Cada evento lleva `id` igual a su `seq`, `event` igual a su `type` y el JSON completo en `data`. Los tipos y campos están en [events.md](events.md).
- Para reconectar, se repite la petición con `Last-Event-ID: <último seq recibido>`. La API reenvía los eventos posteriores, que guardó antes de enviarlos, y continúa. Sin la cabecera se reenvía todo desde el principio. El cliente descarta los `seq` repetidos.
- Mientras un agente trabaja llega un comentario `: ping` cada `SSE_HEARTBEAT_SECONDS` (15 s).
- El stream se cierra solo tras `en_espera_humano` o `corrida_fin`. Tras aprobar, se abre otro stream con el último `seq` como `Last-Event-ID`.
- Solo puede haber un stream por corrida. Si llega otro mientras el anterior sigue abierto, recibe `409 stream_activo`; se reintenta en uno o dos segundos.
- Si el cliente se va a mitad de un agente, la ejecución se cancela y el siguiente stream repite ese agente desde el último checkpoint. Lo mismo pasa si se cae la instancia: Postgres libera el lock al perder su sesión, la corrida queda en `en_curso` y el siguiente stream la retoma.
- Un error no previsto fuera de los agentes (un fallo de la base o un bug de un nodo) no corta el stream en seco: llega `corrida_fin` con `estado: "error"`, `codigo: "error_interno"` y un mensaje genérico, sin detalles. La corrida pasa a `fallida`, el cupo se ajusta a lo que de verdad se consumió y el error se reporta a Sentry solo con su tipo, la traza y el `run_id`, sin el mensaje, las variables ni los breadcrumbs.
- El cierre (ajuste del cupo, copia al historial y borrado) se puede repetir sin efectos dobles. Si la instancia cae después de `corrida_fin`, el siguiente stream solo termina el cierre: no vuelve a ejecutar el grafo y no ajusta el cupo dos veces.
- `EventSource` no permite enviar `Authorization`, así que la web consume el stream con `fetch` y un lector de `ReadableStream`.

Una corrida sin actividad durante `RUN_TTL_MINUTES` pasa a `fallida` al crear la siguiente corrida de cualquier usuario. La reserva del cupo se cambia por el costo de los agentes que alcanzaron a entregar, y se borran sus eventos y checkpoints. La limpieza toma el lock del stream y vuelve a comprobar la inactividad, así que nunca toca una corrida con un stream abierto. Al terminar cualquier corrida se borran sus eventos y checkpoints, y solo queda la copia del historial si el usuario lo tiene activado.

## Claves propias

- Proveedores que aceptan clave propia: `openai`, `anthropic`, `groq` y `openai_compatible`. `openai_compatible` exige `base_url` en `https` hacia una dirección pública; para el resto, `base_url` no se acepta.
- Antes de guardar, la clave se valida con la llamada más barata del proveedor. Rechazada: `422 clave_invalida`; sin respuesta del proveedor: `422 clave_no_verificable`. En ninguno de los dos casos se guarda.
- Cada intento de validación cuenta para `CREDENTIAL_CHECKS_PER_HOUR` (10 por hora y usuario), haya salido bien o mal, para que la API no sirva para probar claves robadas en masa. Pasado el límite: `429 limite_validaciones`.
- Se guarda cifrada con AES-256-GCM: nonce aleatorio de 12 bytes, versión de llave y datos asociados con el usuario y el proveedor, así que un texto cifrado copiado a otra fila no se descifra. Las respuestas solo devuelven los últimos 4 caracteres.
- La clave se descifra al abrir cada stream y solo vive en la selección del modelo; nunca entra en eventos, checkpoints, logs ni respuestas.

## Límites

| Límite | Variable | Por defecto | Código |
| --- | --- | --- | --- |
| Corridas por usuario en la última hora | `USER_RUNS_PER_HOUR` | 5 | `429 limite_hora` |
| Corridas por usuario en el día (UTC) | `USER_RUNS_PER_DAY` | 20 | `429 limite_dia` |
| Corridas diarias con claves del servidor | `GLOBAL_DAILY_RUNS` | 25 (11 en producción) | `429 cupo_gratuito_agotado` |
| Dólares diarios con claves del servidor | `GLOBAL_DAILY_BUDGET_USD` | 0.09 (0.10 en producción) | `429 cupo_gratuito_agotado` |

Los límites por usuario aplican con o sin clave propia. El cupo global solo cuenta corridas en las que alguna parte usa la clave del servidor ([ADR 0019](adr/0019-groq-developer-for-the-free-mode.md)). La reserva es atómica: las corridas de un usuario se serializan con un advisory lock y el cupo global se toma con un `UPDATE` condicional, de modo que dos peticiones simultáneas nunca superan el tope. Al terminar, el costo reservado se sustituye por el real.

## Errores

Todas las respuestas de error tienen la forma `{"code": "...", "message": "..."}`, sin detalles de validación ni eco de lo enviado.

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `no_autenticado` | 401 | Falta el token o no es válido |
| `correo_no_verificado` | 403 | El claim de correo verificado no es `true` |
| `no_encontrado` | 404 | No existe o es de otro usuario; también rutas desconocidas |
| `metodo_no_permitido` | 405 | Método no soportado en la ruta |
| `estado_invalido` | 409 | La corrida no está en un estado que permita la acción |
| `stream_activo` | 409 | Ya hay un stream abierto para la corrida |
| `versiones_agotadas` | 409 | Ya se pidieron dos versiones nuevas de las historias en la corrida |
| `cuerpo_demasiado_grande` | 413 | El cuerpo supera `MAX_REQUEST_BYTES` |
| `entrada_invalida` | 422 | El cuerpo no cumple el esquema o la regla de negocio |
| `clave_requerida` | 422 | El proveedor necesita la clave del usuario |
| `proveedor_no_permitido` | 422 | Proveedor o modelo fuera del catálogo |
| `destino_no_permitido` | 422 | `base_url` no es `https` o apunta a una dirección no pública |
| `clave_invalida` / `clave_no_verificable` | 422 | La validación de la clave falló |
| `limite_hora`, `limite_dia`, `cupo_gratuito_agotado`, `limite_validaciones` | 429 | Límites de uso |
| `error_interno` | 500 | Error no previsto; el log registra solo su tipo y se reporta a Sentry sin el mensaje. Sale con las cabeceras CORS, así que la web ve el error real y no un falso error de CORS |

Los fallos de los agentes durante el stream no son errores HTTP: llegan como eventos `agente_error` y `corrida_fin` con `estado: "error"`.

## Cuentas

Cada `user_id` de `app` tiene una llave foránea hacia `auth."user"` con borrado en cascada (migración 0004). Cuando la web borra una cuenta, Postgres borra sus ajustes, claves, validaciones, uso, corridas en curso con sus eventos e historial. Los checkpoints de `graph` no tienen llave foránea: la limpieza oportunista borra los que ya no tienen corrida.

## Modelos simulados

Con `MODEL_BACKEND=fake` la API responde con modelos deterministas y valida las claves sin red, para las pruebas de punta a punta. Pasan por los agentes, los prompts, los validadores y el grafo reales: el Revisor pide una corrección la primera vez, y una clave que contiene `nosaldo` falla como una cuenta sin saldo. `FAKE_MODEL_DELAY_MS` fija la espera de cada llamada. La API se niega a arrancar con `MODEL_BACKEND=fake` si `APP_ENV` no es `test`.

## Endurecimiento HTTP

- CORS solo para `WEB_ORIGIN`, sin credenciales, con los métodos `GET`, `POST`, `PUT` y `DELETE` y las cabeceras `authorization`, `content-type` y `last-event-id`. También los 500: un middleware dentro de CORS responde `error_interno` a cualquier error no manejado, porque el manejador de Starlette para `Exception` corre fuera de todos los middlewares y su respuesta salía sin cabeceras CORS.
- Límite de tamaño del cuerpo (`MAX_REQUEST_BYTES`, 64 KiB), tanto por `Content-Length` como por lo que llega en streaming.
- `Cache-Control: no-store` en todo salvo `/health` y `/evaluation`, más `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security` y una CSP `default-src 'none'`.
- Una línea de log JSON por petición con ruta plantilla, estado y duración. El usuario aparece solo como un seudónimo (los primeros 12 caracteres del SHA-256 de su id); no se registran cuerpos, tokens, claves ni correos.
- Cada proveedor tiene su tiempo límite (`PROVIDER_TIMEOUTS`) y como mucho un reintento ante errores de conexión o respuestas 500, 502, 503 o 504; nunca ante un 4xx.

## Contrato

- `uv run criteria-contract` (en `services/api`) escribe `contract/schema.json` con los cuerpos de petición, los de respuesta y la unión `Evento`. Los modelos cuyo esquema de entrada y salida difieren aparecen como `XInput` (petición) y `X` (respuesta).
- `pnpm gen:api` (en `apps/web`) genera `src/shared/api/types.gen.ts` con `json-schema-to-typescript`.
- El CI falla si cualquiera de los dos archivos no coincide con lo que se generaría: `criteria-contract --check` en el job de la API y `pnpm gen:api` seguido de `git diff --exit-code` en el de la web.
