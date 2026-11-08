# Arquitectura

CriterIA es un monorepo con dos partes independientes que comparten un contrato de eventos: la web en Next.js (`apps/web`) y la API en Python (`services/api`). Cada parte usa su propio gestor de paquetes (pnpm y uv) y tiene su propio job en el CI ([ADR 0001](adr/0001-monorepo.md)).

## Vista general

```mermaid
flowchart LR
  browser["Navegador"]

  subgraph vercel["Vercel"]
    web["Next.js<br/>UI, Better Auth, cookie httpOnly<br/>emite JWT corto (5 min)"]
  end

  subgraph gcp["GCP Cloud Run (us-central1)"]
    api["API FastAPI"]
    jwt["Verifica JWT<br/>(JWKS de la web)"]
    graph["Grafo LangGraph"]
    agents["Agentes Pydantic AI"]
  end

  providers["Proveedor de modelos<br/>OpenAI | Anthropic | Groq | Ollama | compatible"]
  db[("Neon Postgres<br/>esquemas auth, app, graph")]

  subgraph local["Máquina de Gus"]
    cli["CLI de evaluación<br/>(Ollama + APIs)"]
  end

  board["Tablero público"]

  browser --> web
  browser -- "SSE directo" --> api
  api --> jwt
  api --> graph --> agents --> providers
  api --> db
  web --> db
  cli -- "publica resultados" --> db
  db --> board
```

El navegador habla con la web para la interfaz y la sesión, y abre el stream SSE directamente contra Cloud Run con un JWT de cinco minutos guardado solo en memoria ([ADR 0008](adr/0008-better-auth-and-api-jwt.md), [ADR 0011](adr/0011-sse-typed-events.md)).

## Almacenamiento

Relacional: Neon Postgres en capa gratuita, con esquemas separados y roles de mínimo privilegio ([ADR 0007](adr/0007-neon-postgres-schemas.md)).

| Esquema | Dueño | Migraciones | Contenido |
| --- | --- | --- | --- |
| `auth` | web (`web_role`) | CLI de Better Auth (`pnpm auth:migrate`) | Usuarios, sesiones, cuentas, verificaciones, JWKS (llave privada cifrada) y rate limit |
| `app` | `migrator_role` (la API lee y escribe con `api_role`) | Alembic | Ajustes, claves cifradas, uso y cupos, corridas en curso y sus eventos, historial, evaluación |
| `graph` | `migrator_role` (la API lee y escribe con `api_role`) | Migraciones de LangGraph, aplicadas por Alembic | Checkpoints de las corridas en curso |

Roles ([services/api/db/roles.sql](../services/api/db/roles.sql), idempotente):

| Rol | Puede | No puede |
| --- | --- | --- |
| `migrator_role` | DDL en `app` y `graph` | leer `auth` |
| `api_role` | leer y escribir filas de `app` y `graph`; solo leer las tablas de evaluación | crear o alterar tablas, tocar la versión de Alembic o de los checkpoints, ver `auth` |
| `eval_writer` | insertar resultados de evaluación desde la CLI local | leer corridas, claves o ajustes, borrar o actualizar |
| `web_role` | dueño de `auth` (Better Auth, desde F4) | tocar `app` o `graph` |

La API nunca ejecuta DDL: al arrancar comprueba que los checkpoints estén en la última migración y, si no, se niega a arrancar. `user_id` es texto sin llave foránea hasta que exista `auth.user` en F4.

Se eligió un modelo relacional porque las métricas de evaluación se comparan con SQL (agregados por modelo, versión y criterio). Los artefactos y puntajes viven en `jsonb` validado por esquema en la API.

## API: arquitectura hexagonal

[ADR 0002](adr/0002-hexagonal-api.md). Las dependencias apuntan al dominio y la composición ocurre en un único módulo de arranque.

```
services/api/
  src/criteria/
    domain/        artifacts (Requerimiento, HistoriaUsuario, CriterioAceptacion, CasoPrueba,
                   Observacion, VeredictoRevisor, Puntaje), reglas puras, eventos, respuesta
                   humana y ProviderSelection; solo Pydantic
    application/   grafo de LangGraph (graph.py), servicio de corridas (runs.py: iniciar,
                   continuar, reanudar y descartar), casos de uso HTTP de corridas (run_api.py),
                   claves (credentials.py) y cuenta (accounts.py), errores con código
    ports/         AgentRunner por rol, EventSink, Checkpointer, Clock, KeyValidator, ModelRouter,
                   TokenVerifier, Cipher, CredentialStore, RunStore, UsageGuard, SettingsStore,
                   HistoryStore, EvaluationReader, ErrorReporter
    adapters/
      llm/         registro de proveedores, catálogo (niveles, precios, perfil de consumo), protección
                   SSRF y validación de claves
      agents/      agentes de Pydantic AI expuestos como AgentRunner, bloques de datos, prompts
      memory/      checkpointer y sink de eventos en memoria (CLI y pruebas)
      postgres/    tablas (SQLAlchemy Core), stores, reserva de cupos y checkpointer de LangGraph
      auth/        verificación de JWT con JWKS en caché
      crypto/      cifrado AES-256-GCM de las claves con versiones de llave
      http/        rutas FastAPI, esquemas, errores, middleware de endurecimiento, SSE y contrato
      cli/         comando `criteria run` y salida legible o JSON por línea
      system_clock.py
    bootstrap.py   módulo de arranque: arma registro, agentes y servicios para la CLI y la API
    config.py      validación de variables al arrancar (pydantic-settings)
    observability.py  Sentry, activo solo con DSN y con filtro de cabeceras sensibles
    main.py        create_app y arranque de uvicorn
  prompts/v1/      prompts de sistema de Analista, QA y Revisor
  prompts/juez/v1/ prompt del Evaluador, con versión propia y congelado (ADR 0015)
  config/models.toml  modelos permitidos por proveedor y precios
  contract/schema.json  JSON Schema de cuerpos y eventos, fuente de los tipos de la web
  db/roles.sql     roles y esquemas; lo aplica el dueño de la base antes de migrar
  migrations/      Alembic: tablas de app y migraciones de los checkpoints en graph
  docker-compose.yml  Postgres 16 local
  examples/        requerimientos de ejemplo para la CLI
```

| Capa | Puede depender de | No puede depender de |
| --- | --- | --- |
| `domain` | biblioteca estándar y Pydantic | todo lo demás |
| `application` | `domain`, `ports`, LangGraph | `adapters`, frameworks de transporte |
| `ports` | `domain`; `Checkpointer` expone el saver de LangGraph ([ADR 0005](adr/0005-langgraph-orchestration.md)) | `adapters` |
| `adapters` | `domain`, `application`, `ports`, bibliotecas externas | — |

Puertos:

| Puerto | Responsabilidad | Adaptadores |
| --- | --- | --- |
| `AgentRunner[Entrada, Salida]` | Ejecuta un agente y devuelve la salida validada con su uso (tokens, latencia, costo, reintentos); si falla, lanza `AgentRunError` con un código y un mensaje seguros | `PydanticAgentRunner` |
| `EventSink` | Recibe los eventos de una corrida en orden y les asigna `seq` creciente y `ts` | `ListEventSink` (pruebas), `PrintingEventSink` (CLI), `StoreEventSink` (guarda en `app.run_event` y entrega al stream) |
| `Checkpointer` | Guarda el estado del grafo entre la pausa humana y la reanudación, y lo borra al terminar | `MemoryCheckpointer`, `PostgresCheckpointer` |
| `Clock` | Hora con zona y reloj monotónico, para que las pruebas controlen `ts` y latencia | `SystemClock`; `FakeClock` en pruebas |
| `KeyValidator` | Comprueba una clave con la llamada más barata del proveedor (listar modelos) y devuelve `valida`, `invalida` o `no_verificable` con los últimos 4 caracteres, sin guardar ni registrar la clave | `HttpKeyValidator` |
| `ModelRouter` | Acceso del servidor por proveedor, niveles, validación de la selección y costo estimado por parte | `ProviderRegistry` |
| `TokenVerifier` | Convierte un JWT en `Principal` (`user_id`, correo verificado) o lanza `AuthError` | `JwtVerifier` con `JwksCache` |
| `Cipher` | Cifra y descifra una clave con datos asociados | `AesGcmCipher` |
| `CredentialStore`, `SettingsStore`, `HistoryStore`, `EvaluationReader` | Persistencia por usuario | adaptadores de `postgres/`; en memoria en las pruebas unitarias |
| `RunStore` | Corrida en curso, sus eventos, estado, aprobación, abandonadas y lock del stream | `PostgresRunStore` (advisory lock de sesión) |
| `UsageGuard` | Reserva atómica de los límites por usuario y del cupo global, y ajuste al costo real una sola vez por corrida | `PostgresUsageGuard` |
| `ErrorReporter` | Reporta un error no previsto de una corrida sin datos del usuario | `SentryErrorReporter` (tipo, traza y `run_id`; sin mensaje, variables ni breadcrumbs) |

Detalle de agentes, grafo, reintentos y rondas en [agents.md](agents.md), de los eventos en [events.md](events.md) y de los endpoints, la autenticación, los límites y los errores en [api.md](api.md).

Estado en F3: la API expone las corridas por HTTP con el ciclo ligado al stream ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)), claves cifradas, ajustes, catálogo, historial y el tablero público de evaluación. Las rutas viven en `adapters/http` y `create_app` arma los servicios dentro del lifespan, porque los pools de Postgres y el checkpointer se atan al event loop que sirve. En producción no se publican `/docs` ni `/openapi.json`.

## Web: Feature-Sliced Design

[ADR 0003](adr/0003-feature-sliced-web.md), ajustado por el [ADR 0013](adr/0013-nextjs-routes-outside-src.md).

```
apps/web/
  app/           rutas del App Router; delgadas: reexportan las rutas de src/pages y el handler
                 de Better Auth (app/api/auth/[...all])
  pages/         vacía a propósito, para que Next.js no tome src/pages como Pages Router
  proxy.ts       CSP con nonce por petición (ADR 0014) y redirección de las páginas privadas
                 sin cookie de sesión
  e2e/           Playwright: flujos, correo (Mailpit) y pantallas con axe y CSP
  src/
    app/         layout raíz, fuentes y estilos globales
    pages/       home, run, history, history-detail, evaluation, settings, privacy, recovery;
                 cada una con su componente de ruta en el servidor (sesión y redirecciones)
    widgets/     encabezado, vista-clasica, panel-agente, tablero-evaluacion
    features/    autenticacion, ejecutar-corrida, aprobar-historias, exportar, cambiar-vista,
                 gestionar-claves, controles-datos
    entities/    corrida (agentes, reductor de eventos a estado y textos derivados)
    shared/      api (cliente, token en memoria, stream SSE, tipos generados), config (entorno
                 público y del servidor, proveedores), lib (auth, email, sse, security, react,
                 testing), ui (Ficha, botones, campos, pestañas, cajón, avisos)
```

Reglas, verificadas con `eslint-plugin-boundaries`:

- Cada capa importa solo capas inferiores (`app` > `pages` > `widgets` > `features` > `entities` > `shared`).
- Los slices se importan por su API pública (`index.ts`), nunca por rutas internas.
- Los slices de una misma capa no se importan entre sí.
- Nada en `src/` importa desde `app/` (las rutas de Next.js).
- El alias `@/` apunta a `src/`.

Las dos vistas de la corrida (clásica y, en F9, oficina) son widgets sobre la misma entidad `corrida`: `runReducer` es una función pura que reduce los eventos SSE a estado (descarta los `seq` repetidos tras una reconexión) y ninguna vista interpreta eventos por su cuenta. El control de vista y `?vista=` ya existen, pero quedan ocultos con `NEXT_PUBLIC_OFFICE_VIEW=false`.

### Autenticación y sesión

[ADR 0008](adr/0008-better-auth-and-api-jwt.md), ajustado por el [ADR 0020](adr/0020-github-first-sign-in-without-email.md).

- Better Auth vive en `src/shared/lib/auth`: `options.ts` arma la configuración (pura y probada), `server.ts` la instancia con un pool de `pg` sobre el esquema `auth` como `web_role`, y `client.ts` es el cliente del navegador. Se construye al primer uso, así que `next build` no necesita los secretos del servidor.
- "Continuar con GitHub" con el scope `user:email`; los tokens de GitHub se descartan antes de llegar a la base. Correo y contraseña con 12 caracteres como mínimo. Nunca se vincula GitHub con una cuenta local cuyo correo no esté verificado.
- `EMAIL_PROVIDER` (`none`, `smtp` o `resend`) decide si hay verificación y recuperación; el envío está en `src/shared/lib/email`.
- Rate limit de Better Auth guardado en la tabla `auth.rateLimit` (sirve entre instancias serverless): registro por IP (20 por hora), inicio de sesión por IP y además por cuenta (10 cada 15 minutos, con el correo guardado solo como hash).
- Sesión en cookie httpOnly y SameSite=Lax, con `Secure` y prefijo `__Secure-` en producción.
- El plugin JWT emite tokens EdDSA de 5 minutos con `iss`, `aud` y `email_verified`. En el navegador, `shared/api/token.ts` los guarda solo en memoria (un closure), los renueva un minuto antes de que expiren y los envía como `Authorization: Bearer`.
- El stream usa `fetch` con un parser SSE propio (`shared/lib/sse`), porque `EventSource` no envía cabeceras: reconecta con `Last-Event-ID`, espera ante `409 stream_activo`, muestra los latidos como conexión viva y se cancela al salir de la página.
- Los formularios con secretos (contraseña, clave de API, requerimiento) usan `method="post"` y no se pueden enviar antes de la hidratación, para que el navegador nunca los mande en una URL.
- Eliminar la cuenta borra `auth.user`; las llaves foráneas de `app` borran en cascada los datos de la API.

Los tokens de diseño viven en `src/shared/ui/tokens.css` (claro y oscuro con `prefers-color-scheme`), y las fuentes Plus Jakarta Sans y JetBrains Mono se sirven desde el propio origen con `next/font`. La `Ficha` tiene insignia de rol, patas, parpadeo ocasional y balanceo al trabajar, sin animación con `prefers-reduced-motion`. La escala de espaciado, los tokens de movimiento y sus reglas están en [ui.md](ui.md).

## Contrato

Los esquemas Pydantic de los cuerpos HTTP y de los eventos se exportan como JSON Schema a `services/api/contract/schema.json` (`uv run criteria-contract`), y de ahí `pnpm gen:api` genera los tipos TypeScript versionados en `apps/web/src/shared/api/types.gen.ts` con `json-schema-to-typescript`. El CI falla si cualquiera de los dos archivos no coincide con lo que se generaría ([api.md](api.md#contrato)).

Eventos SSE: todos llevan `run_id`, `seq` (entero creciente), `ts` y `agent`. El cliente descarta duplicados por `seq` y se reconecta con `Last-Event-ID` ([ADR 0011](adr/0011-sse-typed-events.md)).

## Seguridad transversal

- Variables de entorno validadas al arrancar en ambas partes: pydantic-settings en la API y zod en la web. Una variable obligatoria ausente detiene el arranque con un mensaje que la nombra.
- Sentry en ambas partes, activo solo con DSN, con `send_default_pii` / `sendDefaultPii` en falso y un filtro que elimina las cabeceras `authorization`, `cookie` y `x-provider-key` y las cookies de la petición. La API además no envía variables locales, y los errores de corrida llegan sin mensaje ni breadcrumbs.
- CSP estricta con nonce, sin `'unsafe-inline'` ni `'unsafe-eval'` en producción, más cabeceras fijas en `next.config.ts` ([ADR 0014](adr/0014-nonce-based-csp.md)).
- Imagen de la API multi-etapa, con usuario no root y `PORT` tomado del entorno, como lo inyecta Cloud Run.
- Las URLs base que envía el usuario (`openai_compatible`) pasan por un transporte propio sobre `httpx2`/`httpcore2`, el cliente HTTP del SDK de OpenAI. Ese transporte exige `https`, no sigue redirecciones y limita el tiempo y el tamaño de la respuesta. Además resuelve el DNS, rechaza direcciones no públicas y se conecta a la IP que validó. La URL de Ollama sale de la configuración del servidor y queda fuera de esa regla.
- Cada usuario paga sus modelos con su propia clave ([ADR 0016](adr/0016-claves-por-usuario.md)). La clave del servidor solo se usa con los proveedores de `SERVER_KEY_PROVIDERS` (en producción, Groq Developer con tope diario, [ADR 0019](adr/0019-groq-developer-for-the-free-mode.md)) y nunca se cambia de proveedor automáticamente. Las claves propias se guardan cifradas con AES-256-GCM, con datos asociados al usuario y al proveedor y llaves versionadas (`CREDENTIALS_KEYS`), que en producción viven en Secret Manager.
- JWT de la web verificados con JWKS, solo algoritmos asimétricos, y correo verificado obligatorio para crear corridas y guardar claves. Errores con código y sin eco de la entrada, CORS limitado al origen de la web y sin credenciales, límite de tamaño del cuerpo y logs sin datos personales ([api.md](api.md)).
- La clave propia es un `SecretStr` que solo vive en la selección de la corrida. No entra en el estado del grafo, en los checkpoints, en los eventos ni en los logs, y los errores de validación de una selección nunca contienen los valores enviados.
- El requerimiento y los artefactos llegan a los modelos como JSON dentro de etiquetas, con `<`, `>` y `&` escapados, para que ningún texto pueda cerrar la etiqueta ni pasar por instrucción.

## Principios

- SOLID, DRY, KISS y YAGNI: cada fase agrega solo lo que usa.
- Dependencias hacia el dominio; núcleo sin E/S y probado sin red.
- Configuración por entorno, validada al arrancar.
- Salidas de LLM siempre validadas por esquema; ninguna prueba del CI llama a un modelo real.
- Lógica de dominio pura y separada de la UI y de la infraestructura.

## Patrones

| Patrón | Dónde | Por qué |
| --- | --- | --- |
| Puertos y adaptadores | API | Proveedores, persistencia y transporte intercambiables y probables sin red |
| Composition root | `services/api/src/criteria/bootstrap.py` | Un solo lugar arma las dependencias para la CLI y la API |
| Fábrica de aplicación | `create_app(settings)` | Pruebas con configuración aislada |
| Capas y slices (FSD) | Web | Las vistas crecen sin mezclar lógica de corrida y presentación |
| Funciones puras para políticas | `buildContentSecurityPolicy`, `scrub_sensitive_data`, `marcar_origen`, `cambios_historias` | Reglas de seguridad y de dominio probadas unitariamente |
| Plantilla (template method) | `EventSink.emit` y `deliver` | La numeración de `seq` vive en un solo lugar; cada adaptador solo entrega |
| Reserva y liquidación | `UsageGuard.reserve` y `settle` | El cupo se toma de forma atómica al crear y se ajusta al costo real al terminar |
| Lock consultivo | `RunStore.stream_lock` y la reserva por usuario | Un stream por corrida y reservas serializadas sin tablas de bloqueo; Postgres lo libera si la conexión cae |
| Repositorio | stores de `adapters/postgres` | Los casos de uso no conocen SQL y se prueban con stores en memoria |
| Uniones discriminadas | `Evento` por `type`, `Artefactos` por `tipo` | Un solo esquema de eventos para la CLI, SSE y los tipos TypeScript |
| Modelos simulados | `FunctionModel` de Pydantic AI en las pruebas | El grafo completo se prueba sin red ni modelos reales |

## Stack

| Parte | Tecnología |
| --- | --- |
| Web | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6 estricto, zod 4, CSS Modules, Better Auth 1.7 con `pg`, nodemailer (SMTP), `@sentry/nextjs` |
| Calidad web | ESLint 9 (`eslint-config-next`, `eslint-plugin-boundaries`), Prettier, Vitest con Testing Library, Playwright con `@axe-core/playwright` contra la API real con modelos simulados, Postgres y Mailpit |
| Runtime web | Node.js 26 LTS, pnpm 12 |
| API | Python 3.13, FastAPI, pydantic-settings, uvicorn, `sentry-sdk`, Pydantic AI 2, LangGraph 1, httpx2, SQLAlchemy 2 (Core, async) con psycopg 3, Alembic, `langgraph-checkpoint-postgres`, PyJWT, `cryptography` |
| Calidad API | Ruff (lint y formato), mypy estricto, pytest con pytest-asyncio y cobertura, pruebas de integración contra Postgres 16, pip-audit |
| Entorno API | uv con `.venv` local y `uv.lock` versionado ([ADR 0010](adr/0010-python-environment-uv.md)) |
| Datos | Neon Postgres en producción y Postgres 16 en Docker en local y en el CI; Mailpit en local y en el CI |
| Nube | GCP Cloud Run para la API y Vercel para la web, con despliegue manual ([ADR 0009](adr/0009-cloud-run-and-vercel.md)) |
| CI | GitHub Actions en cada push a `main`; Dependabot semanal agrupado |
