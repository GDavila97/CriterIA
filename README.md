# CriterIA

CriterIA es un asistente multiagente que convierte un requerimiento escrito en lenguaje natural en historias de usuario, criterios de aceptación y casos de prueba. Un agente revisa el resultado y otro lo califica con una rúbrica. Incluye un módulo de evaluación que compara modelos, por API y locales, con métricas reproducibles.

Todo lo que genera es una propuesta: una persona aprueba o edita las historias antes de que se escriban las pruebas, y cada artefacto indica qué agente lo produjo.

El uso gratuito por defecto corre sobre Groq con la clave del servidor. Para usar modelos de pago (OpenAI, Anthropic, Groq con tu cuenta o un endpoint compatible con OpenAI), cada persona usa su propia clave de API. La herramienta nunca cambia de proveedor por su cuenta ([ADR 0016](docs/adr/0016-claves-por-usuario.md)).

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

Fase F2 (núcleo de agentes): los cuatro agentes, el grafo con la pausa humana y las rondas del Revisor corren de punta a punta desde la CLI, con proveedores intercambiables y modo solo local con Ollama. La web todavía muestra una página de inicio provisional, y la API expone solo `GET /healthz`. La base de datos, los endpoints de corrida y la autenticación llegan en F3 y F4.

## Stack

| Parte | Tecnología |
| --- | --- |
| Web (`apps/web`) | Next.js 16 con App Router, React 19, TypeScript estricto, zod, CSS Modules, Sentry |
| API (`services/api`) | Python 3.13, Pydantic AI, LangGraph, FastAPI, pydantic-settings, Sentry |
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
│   ├── prompts/         prompts de sistema: v1/ para los agentes y juez/v1/ para el Evaluador
│   ├── config/          modelos permitidos y precios
│   ├── examples/        requerimientos de ejemplo para la CLI
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

### Correr el grafo de agentes desde la terminal

La CLI corre el flujo completo (Analista → tu aprobación → QA → Revisor → Evaluador) e imprime cada evento. Desde `services/api`, con un `.env` que tenga al menos `APP_ENV`:

```bash
uv run criteria run --provider ollama --model llama3.1:8b --file examples/biblioteca.txt
```

| Opción | Qué hace |
| --- | --- |
| `--provider`, `--model` | Proveedor y modelo de generación; por defecto, `PROVIDER` y `GENERATION_MODEL` del `.env` |
| `--nivel` | `economico`, `equilibrado` o `maximo`, cuando no se indica `--model` (por defecto, `economico`); antes de empezar, la CLI muestra el costo estimado de la corrida |
| `--judge-provider`, `--judge-model` | Proveedor y modelo del Evaluador. Si no se indican (ni `JUDGE_PROVIDER` o `JUDGE_MODEL`), se elige un proveedor distinto con acceso disponible en su nivel económico; si no hay otro, el mismo de generación |
| `--text "…"` o `--file ruta` | El requerimiento (de 20 a 2,000 caracteres) |
| `--auto-aprobar` | Aprueba las historias sin preguntar; sin esta opción, la CLI las muestra y pide aprobar, editar (abre `$EDITOR` con el JSON) o cancelar |
| `--max-rondas N` | Rondas de corrección del Revisor, de 0 a 5; por defecto, `MAX_REVIEW_ROUNDS` |
| `--json` | Un evento JSON por línea en la salida estándar; las preguntas van a la salida de errores |
| `--temperatura`, `--max-tokens` | Parámetros del modelo |
| `--base-url` | URL `https` para `--provider openai_compatible`; la clave se toma de `CRITERIA_USER_API_KEY` en la sesión, nunca de un argumento |
| `--clave-propia` | Usa `CRITERIA_USER_API_KEY` como clave del proveedor de generación (`openai`, `anthropic` o `groq`) en lugar de la del servidor |

Hay tres requerimientos de ejemplo en `services/api/examples/`: `biblioteca.txt`, `citas-medicas.txt` y `nomina.txt`. La CLI sale con 0 si la corrida terminó, 1 si un agente falló, 2 por un error de uso o configuración y 130 si cancelaste. Si la clave falla por invalidez, saldo o límite, la corrida termina con su código y sugiere usar el gratuito; nunca cambia de proveedor sola.

### Modo solo local con Ollama

Con `PROVIDER=ollama` todo el flujo corre sin ninguna clave de API. Los modelos permitidos están en `services/api/config/models.toml`: `llama3.1:8b` (el predeterminado, elegido en F2b) y `qwen3:8b` (con el razonamiento apagado). Los dos usan salida JSON nativa restringida al esquema.

```bash
ollama pull llama3.1:8b
# en services/api/.env
APP_ENV=development
SERVER_KEY_PROVIDERS=ollama
PROVIDER=ollama
GENERATION_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://localhost:11434
```

Ollama puede estar en otra máquina de tu red local: basta con poner su dirección en `OLLAMA_BASE_URL`, por ejemplo `http://192.168.1.50:11434`. Esa URL la define quien opera el servidor, así que puede ser privada; la protección SSRF aplica solo a las URLs que envía el usuario. Si `OLLAMA_BASE_URL` no está definida, el proveedor `ollama` no se ofrece. Ollama no tiene autenticación: nunca expongas su puerto fuera de tu red local.

Las pruebas contra un Ollama real están excluidas por defecto y del CI:

```bash
OLLAMA_BASE_URL=http://localhost:11434 uv run pytest -m ollama --no-cov
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
| `uv run criteria run …` | corre el grafo de agentes en la terminal (ver arriba) |

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
| `PROVIDER`, `GENERATION_MODEL` | API | No | Proveedor y modelo de generación por defecto de la CLI |
| `JUDGE_PROVIDER`, `JUDGE_MODEL` | API | No | Proveedor y modelo del Evaluador; vacíos, la CLI elige un proveedor distinto si hay uno disponible |
| `SERVER_KEY_PROVIDERS` | API | No | Proveedores que pueden usar la clave del servidor, separados por comas; en producción, solo `groq`. Sin ella, toda corrida necesita la clave del usuario (`clave_requerida`) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY` | API | No | Claves del servidor. En producción solo existe la de Groq; las de OpenAI y Anthropic solo viven en un `.env` local para la evaluación |
| `OLLAMA_BASE_URL` | API | No | URL de Ollama; el proveedor `ollama` solo se ofrece con ella y con `ollama` en `SERVER_KEY_PROVIDERS` |
| `PROVIDER_TIMEOUT_SECONDS`, `PROVIDER_MAX_RESPONSE_BYTES` | API | No | Tiempo límite y tamaño máximo de respuesta del proveedor |
| `PROMPT_VERSION`, `JUDGE_VERSION` | API | No | Versión de los prompts de los agentes y, por separado, la del juez (`v1`); el juez no cambia al comparar versiones de los agentes |
| `MAX_REVIEW_ROUNDS` | API | No | Rondas de corrección del Revisor (2) |
| `PROMPTS_DIR`, `MODELS_FILE` | API | No | Rutas de los prompts y del catálogo; la imagen Docker las fija |
| `CRITERIA_USER_API_KEY` | CLI | No | Clave propia para `openai_compatible` o, con `--clave-propia`, para el proveedor de generación; se exporta en la sesión, no va en `.env` |
| `NEXT_PUBLIC_APP_ENV` | Web | Sí | Entorno de la web |
| `NEXT_PUBLIC_API_URL` | Web | Sí | URL de la API; también entra en `connect-src` de la CSP. En producción debe ser `https` |
| `NEXT_PUBLIC_SENTRY_DSN` | Web | No | Sentry se activa solo con DSN |

## Documentación

- [Arquitectura](docs/architecture.md)
- [Agentes y grafo](docs/agents.md)
- [Eventos de una corrida](docs/events.md)
- [Decisiones de arquitectura (ADRs)](docs/adr/README.md)
- [Despliegue](docs/deploy.md)
- [Evaluación de modelos](docs/evaluation.md)
- [Overrides de auditoría de dependencias](docs/audit-exceptions.md)

## Licencia

Todos los derechos reservados. Consulta [LICENSE](LICENSE).
