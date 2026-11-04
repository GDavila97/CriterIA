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
| `auth` | web (`web_role`) | CLI de Better Auth | Usuarios, sesiones, cuentas, verificaciones, JWKS |
| `app` | API (`api_role`) | Alembic | Ajustes de usuario, uso diario, corridas guardadas, evaluación |
| `graph` | API (`api_role`) | Checkpointer de LangGraph | Checkpoints para la pausa humana |

Se eligió un modelo relacional porque las métricas de evaluación se comparan con SQL (agregados por modelo, versión y criterio). Los artefactos y puntajes viven en `jsonb` validado por esquema en la API.

## API: arquitectura hexagonal

[ADR 0002](adr/0002-hexagonal-api.md). Las dependencias apuntan al dominio y la composición ocurre en un único módulo de arranque.

```
services/api/
  src/criteria/
    domain/        artifacts (Requerimiento, HistoriaUsuario, CriterioAceptacion, CasoPrueba,
                   Observacion, VeredictoRevisor, Puntaje), reglas puras, eventos, respuesta
                   humana y ProviderSelection; solo Pydantic
    application/   grafo de LangGraph (graph.py) y servicio de corridas (runs.py): iniciar,
                   reanudar tras la aprobación y descartar
    ports/         AgentRunner por rol con sus entradas, EventSink, Checkpointer, Clock
    adapters/
      llm/         registro de proveedores, catálogo de modelos y precios, protección SSRF
      agents/      agentes de Pydantic AI expuestos como AgentRunner, bloques de datos, prompts
      memory/      checkpointer y sink de eventos en memoria
      cli/         comando `criteria run` y salida legible o JSON por línea
      system_clock.py
    bootstrap.py   módulo de arranque: arma registro, agentes y servicio para la CLI y la API
    config.py      validación de variables al arrancar (pydantic-settings)
    observability.py  Sentry, activo solo con DSN y con filtro de cabeceras sensibles
    main.py        app FastAPI (en F2, solo `GET /healthz`)
  prompts/v1/      prompts de sistema versionados, uno por agente
  config/models.toml  modelos permitidos por proveedor y precios
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
| `EventSink` | Recibe los eventos de una corrida en orden y les asigna `seq` creciente y `ts` | `ListEventSink` (pruebas), `PrintingEventSink` (CLI); SSE en F3 |
| `Checkpointer` | Guarda el estado del grafo entre la pausa humana y la reanudación, y lo borra al terminar | `MemoryCheckpointer`; Postgres en F3 |
| `Clock` | Hora con zona y reloj monotónico, para que las pruebas controlen `ts` y latencia | `SystemClock`; `FakeClock` en pruebas |

Detalle de agentes, grafo, reintentos y rondas en [agents.md](agents.md), y de los eventos en [events.md](events.md).

Estado en F2: el núcleo de agentes corre de punta a punta desde la CLI. `main.py` sigue exponiendo solo `GET /healthz`; en F3 las rutas pasan a `adapters/` y usan el mismo `bootstrap.py`. En producción no se publican `/docs` ni `/openapi.json`.

## Web: Feature-Sliced Design

[ADR 0003](adr/0003-feature-sliced-web.md), ajustado por el [ADR 0013](adr/0013-nextjs-routes-outside-src.md).

```
apps/web/
  app/           rutas del App Router de Next.js; delgadas: solo reexportan src/app y src/pages
  pages/         vacía a propósito, para que Next.js no tome src/pages como Pages Router
  proxy.ts       CSP con nonce por petición (ADR 0014)
  instrumentation.ts, instrumentation-client.ts   Sentry en servidor y navegador
  src/
    app/         layout raíz, fuentes, estilos globales y providers
    pages/       inicio, auth, corrida, historial, evaluación
    widgets/     vista-clasica, vista-oficina, panel-agente, tablero-evaluacion
    features/    ejecutar-corrida, aprobar-historias, cambiar-vista, elegir-proveedor, exportar
    entities/    agente, corrida, artefacto, puntaje
    shared/      cliente API, tipos generados, config (entorno validado con zod), lib, ui
```

Reglas, verificadas con `eslint-plugin-boundaries`:

- Cada capa importa solo capas inferiores (`app` > `pages` > `widgets` > `features` > `entities` > `shared`).
- Los slices se importan por su API pública (`index.ts`), nunca por rutas internas.
- Los slices de una misma capa no se importan entre sí.
- Nada en `src/` importa desde `app/` (las rutas de Next.js).
- El alias `@/` apunta a `src/`.

Las dos vistas de la corrida (clásica y oficina) serán widgets sobre la misma entidad `corrida`, que reduce los eventos SSE a estado; ninguna vista interpreta eventos por su cuenta.

Estado en F1: existe la página de inicio provisional (`src/pages/home`) con el logotipo, que es la `Ficha` de `shared/ui` en color de acento. Los tokens de diseño viven en `src/shared/ui/tokens.css` (claro y oscuro con `prefers-color-scheme`), y las fuentes Plus Jakarta Sans y JetBrains Mono se sirven desde el propio origen con `next/font`.

## Contrato

Los esquemas Pydantic del dominio generan JSON Schema, y de ahí salen los tipos TypeScript versionados en `apps/web/src/shared/api/types.gen.ts`. El CI fallará si los tipos generados no coinciden con los versionados (se agrega en F3, junto con los primeros esquemas).

Eventos SSE: todos llevan `run_id`, `seq` (entero creciente), `ts` y `agent`. El cliente descarta duplicados por `seq` y se reconecta con `Last-Event-ID` ([ADR 0011](adr/0011-sse-typed-events.md)).

## Seguridad transversal

- Variables de entorno validadas al arrancar en ambas partes: pydantic-settings en la API y zod en la web. Una variable obligatoria ausente detiene el arranque con un mensaje que la nombra.
- Sentry en ambas partes, activo solo con DSN, con `send_default_pii` / `sendDefaultPii` en falso y un filtro que elimina las cabeceras `authorization`, `cookie` y `x-provider-key` y las cookies de la petición.
- CSP estricta con nonce, sin `'unsafe-inline'` ni `'unsafe-eval'` en producción, más cabeceras fijas en `next.config.ts` ([ADR 0014](adr/0014-nonce-based-csp.md)).
- Imagen de la API multi-etapa, con usuario no root y `PORT` tomado del entorno, como lo inyecta Cloud Run.
- Las URLs base que envía el usuario (`openai_compatible`) pasan por un transporte propio sobre `httpx2`/`httpcore2`, el cliente HTTP del SDK de OpenAI. Ese transporte exige `https`, no sigue redirecciones y limita el tiempo y el tamaño de la respuesta. Además resuelve el DNS, rechaza direcciones no públicas y se conecta a la IP que validó. La URL de Ollama sale de la configuración del servidor y queda fuera de esa regla.
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
| Uniones discriminadas | `Evento` por `type`, `Artefactos` por `tipo` | Un solo esquema de eventos para la CLI, SSE y los tipos TypeScript |
| Modelos simulados | `FunctionModel` de Pydantic AI en las pruebas | El grafo completo se prueba sin red ni modelos reales |

## Stack

| Parte | Tecnología |
| --- | --- |
| Web | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6 estricto, zod 4, CSS Modules, `@sentry/nextjs` |
| Calidad web | ESLint 9 (`eslint-config-next`, `eslint-plugin-boundaries`), Prettier, Vitest con Testing Library, Playwright con `@axe-core/playwright` |
| Runtime web | Node.js 26 LTS, pnpm 12 |
| API | Python 3.13, FastAPI, pydantic-settings, uvicorn, `sentry-sdk`, Pydantic AI 2, LangGraph 1, httpx2 |
| Calidad API | Ruff (lint y formato), mypy estricto, pytest con pytest-asyncio y cobertura, pip-audit |
| Entorno API | uv con `.venv` local y `uv.lock` versionado ([ADR 0010](adr/0010-python-environment-uv.md)) |
| A partir de F3 | Neon Postgres, Alembic, Better Auth |
| Nube | GCP Cloud Run para la API y Vercel para la web, con despliegue manual ([ADR 0009](adr/0009-cloud-run-and-vercel.md)) |
| CI | GitHub Actions en cada push a `main`; Dependabot semanal agrupado |
