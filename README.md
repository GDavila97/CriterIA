# CriterIA

CriterIA es un asistente multiagente que convierte un requerimiento escrito en lenguaje natural en historias de usuario, criterios de aceptación y casos de prueba. Un agente revisa el resultado y otro lo califica con una rúbrica. Incluye un módulo de evaluación que compara modelos, por API y locales, con métricas reproducibles.

Todo lo que genera es una propuesta: una persona aprueba o edita las historias antes de que se escriban las pruebas, y cada artefacto indica qué agente lo produjo.

**App desplegada:** pendiente (F6).

**Captura:** pendiente. Se agregará en `docs/media/` cuando la vista clásica esté lista (F7).

## Para quién

- Estudiantes y docentes de ingeniería de software, en particular de materias de requisitos y de pruebas.
- Desarrolladores que quieren un primer borrador revisable de historias y casos de prueba.

## Los cuatro agentes

| Agente | Recibe | Entrega |
| --- | --- | --- |
| **Analista** | El requerimiento | Historias de usuario (como / quiero / para), con prioridad y supuestos |
| **QA** | Las historias aprobadas por la persona | Criterios de aceptación y casos de prueba por historia, en tabla y en Gherkin (Dado / Cuando / Entonces) |
| **Revisor** | Historias, criterios y casos | Observaciones (ambigüedad, inconsistencia o faltante) con destino y sugerencia; devuelve trabajo hasta dos rondas |
| **Evaluador** | Los artefactos finales | Puntaje de 1 a 5 en claridad, verificabilidad, completitud y consistencia, con justificación breve |

Flujo: Analista → pausa para que la persona apruebe o edite → QA → Revisor (con hasta dos rondas de corrección) → Evaluador.

## Estado

Fase F1 (fundaciones): estructura del monorepo, calidad, CI y documentación. La web muestra una página de inicio provisional y la API expone `GET /healthz`. Los agentes, la base de datos y la autenticación llegan en las fases siguientes.

## Stack

| Parte | Tecnología |
| --- | --- |
| Web (`apps/web`) | Next.js 16 con App Router, React 19, TypeScript estricto, zod, CSS Modules, Sentry |
| API (`services/api`) | Python 3.13, FastAPI, pydantic-settings, Sentry; Pydantic AI y LangGraph desde F2 |
| Datos | Neon Postgres (desde F3) |
| Nube | GCP Cloud Run (API) y Vercel (web) |
| Calidad | ESLint, Prettier, Vitest, Playwright con axe · Ruff, mypy, pytest, pip-audit |
| CI | GitHub Actions, Dependabot y gitleaks |

## Arquitectura

Monorepo con la web y la API separadas. La API sigue una arquitectura hexagonal (dominio, aplicación, puertos y adaptadores) y la web, Feature-Sliced Design. El navegador recibe los eventos de los agentes por SSE directamente desde la API.

Detalle en [docs/architecture.md](docs/architecture.md) y decisiones en [docs/adr/](docs/adr/README.md).

## Estructura del repositorio

```
.
├── apps/web/            Next.js (FSD)
│   ├── app/             rutas del App Router (delgadas)
│   ├── e2e/             pruebas de Playwright con axe
│   └── src/             app, pages, widgets, features, entities, shared
├── services/api/        API en Python (hexagonal)
│   ├── src/criteria/    domain, application, ports, adapters, config
│   ├── tests/
│   └── Dockerfile
├── docs/                arquitectura, ADRs, despliegue y evaluación
└── .github/             CI y Dependabot
```

## Desarrollo local

### Requisitos

- Node.js 26 LTS (fijado en `apps/web/.nvmrc`) y pnpm 12 (lo selecciona Corepack o pnpm a partir de `packageManager`).
- [uv](https://docs.astral.sh/uv/) 0.13.7 exactamente: `services/api/pyproject.toml` lo exige en `[tool.uv] required-version` y uv se niega a correr con otra versión. uv instala Python 3.13 según `services/api/.python-version`.
- Docker, opcional, para construir la imagen de la API.

### API

```bash
cd services/api
cp .env.example .env      # APP_ENV es obligatoria
uv sync --frozen
make run                  # http://127.0.0.1:8080/healthz
```

### Web

```bash
cd apps/web
cp .env.example .env.local   # NEXT_PUBLIC_APP_ENV y NEXT_PUBLIC_API_URL son obligatorias
pnpm install --frozen-lockfile
pnpm dev                     # http://localhost:3000
```

Si falta una variable obligatoria, la API y la web se niegan a arrancar y el mensaje dice cuál falta.

### Modo solo local con Ollama

> Disponible a partir de F2: en F1 la variable ya está declarada, pero todavía no hay agentes que la usen.

Con `PROVIDER=ollama`, todo el flujo corre en tu máquina sin ninguna clave de API:

```bash
ollama serve
ollama pull <modelo>          # el modelo local se elige en F2
# en services/api/.env
PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
```

### Imagen de la API

```bash
cd services/api
docker build -t criteria-api .
docker run --rm -e APP_ENV=development -e PORT=8080 -p 8080:8080 criteria-api
```

La imagen corre con un usuario sin privilegios y toma el puerto de `PORT`, como lo inyecta Cloud Run.

## Scripts

API (`services/api`, con `make`):

| Script | Qué hace |
| --- | --- |
| `make lint` | Ruff check |
| `make format` / `make format-check` | Ruff format, o solo verificación |
| `make typecheck` | mypy en modo estricto |
| `make test` | pytest con cobertura mínima del 90 % |
| `make audit` | pip-audit sobre `uv.lock` |
| `make check` | todo lo anterior |
| `make run` | levanta la API |

Web (`apps/web`, con `pnpm`):

| Script | Qué hace |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | desarrollo, build y servidor de producción |
| `pnpm lint` | ESLint, incluida la regla de capas FSD |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | genera los tipos de Next.js y corre `tsc --noEmit` |
| `pnpm test` | Vitest con cobertura mínima del 90 % |
| `pnpm e2e` | Playwright en escritorio y a 390 px, claro y oscuro, con axe y verificación de CSP (requiere `pnpm build`) |
| `pnpm audit` | `pnpm audit --audit-level=moderate` |

## Variables de entorno

Las listas completas, con la fase en que se usa cada variable, están en [services/api/.env.example](services/api/.env.example) y [apps/web/.env.example](apps/web/.env.example). Nunca se versionan valores reales.

| Variable | Parte | Obligatoria en F1 | Uso |
| --- | --- | --- | --- |
| `APP_ENV` | API | Sí | `development`, `test` o `production`; en producción se ocultan `/docs` y `/openapi.json` |
| `HOST`, `PORT` | API | No | Interfaz y puerto (por defecto `127.0.0.1:8080`; la imagen usa `0.0.0.0`) |
| `LOG_LEVEL` | API | No | Nivel de log de uvicorn |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | API | No | Sentry se activa solo con DSN |
| `NEXT_PUBLIC_APP_ENV` | Web | Sí | Entorno de la web |
| `NEXT_PUBLIC_API_URL` | Web | Sí | URL de la API; también entra en `connect-src` de la CSP. En producción debe ser `https` |
| `NEXT_PUBLIC_SENTRY_DSN` | Web | No | Sentry se activa solo con DSN |

## Documentación

- [Arquitectura](docs/architecture.md)
- [Decisiones de arquitectura (ADRs)](docs/adr/README.md)
- [Despliegue](docs/deploy.md)
- [Evaluación de modelos](docs/evaluation.md)
- [Overrides de auditoría de dependencias](docs/audit-exceptions.md)

## Licencia

Todos los derechos reservados. Consulta [LICENSE](LICENSE).
