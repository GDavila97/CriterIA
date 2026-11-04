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
services/api/src/criteria/
  domain/        esquemas Pydantic (Requerimiento, HistoriaUsuario, CriterioAceptacion,
                 CasoPrueba, Observacion, Puntaje), rúbrica y eventos; sin dependencias externas
  application/   grafo y casos de uso (ejecutar corrida, reanudar tras aprobación, evaluar lote)
  ports/         interfaces: LLMProvider, RunRepository, EvalRepository, UsageLimiter, Clock
  adapters/      proveedores (pydantic-ai), Postgres, FastAPI (rutas, SSE, auth) y CLI
  config.py      validación de variables al arrancar (pydantic-settings)
  observability.py  Sentry, activo solo con DSN y con filtro de cabeceras sensibles
  main.py        módulo de arranque: compone la app y la sirve con uvicorn
```

| Capa | Puede depender de | No puede depender de |
| --- | --- | --- |
| `domain` | biblioteca estándar y Pydantic | todo lo demás |
| `application` | `domain`, `ports` | `adapters`, frameworks de transporte |
| `ports` | `domain` | `adapters` |
| `adapters` | `domain`, `application`, `ports`, bibliotecas externas | — |

Estado en F1: las cuatro capas existen vacías. `main.py` expone solo `GET /healthz`, que devuelve `{"status": "ok", "version": "<versión del paquete>"}`; en F3 las rutas pasan a `adapters/` y `main.py` queda solo como composición. En producción no se publican `/docs` ni `/openapi.json`.

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
| Composition root | `services/api/src/criteria/main.py` | Un solo lugar arma las dependencias |
| Fábrica de aplicación | `create_app(settings)` | Pruebas con configuración aislada |
| Capas y slices (FSD) | Web | Las vistas crecen sin mezclar lógica de corrida y presentación |
| Funciones puras para políticas | `buildContentSecurityPolicy`, `scrub_sensitive_data` | Reglas de seguridad probadas unitariamente |

## Stack

| Parte | Tecnología |
| --- | --- |
| Web | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6 estricto, zod 4, CSS Modules, `@sentry/nextjs` |
| Calidad web | ESLint 9 (`eslint-config-next`, `eslint-plugin-boundaries`), Prettier, Vitest con Testing Library, Playwright con `@axe-core/playwright` |
| Runtime web | Node.js 26 LTS, pnpm 12 |
| API | Python 3.13, FastAPI, pydantic-settings, uvicorn, `sentry-sdk` |
| Calidad API | Ruff (lint y formato), mypy estricto, pytest con pytest-asyncio y cobertura, pip-audit |
| Entorno API | uv con `.venv` local y `uv.lock` versionado ([ADR 0010](adr/0010-python-environment-uv.md)) |
| A partir de F2 y F3 | Pydantic AI, LangGraph, Neon Postgres, Alembic, Better Auth |
| Nube | GCP Cloud Run para la API y Vercel para la web, con despliegue manual ([ADR 0009](adr/0009-cloud-run-and-vercel.md)) |
| CI | GitHub Actions en cada push a `main`; Dependabot semanal agrupado |
