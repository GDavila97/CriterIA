# Registro de decisiones de arquitectura

Cada ADR sigue el formato Estado, Contexto, Decisión, Alternativas y Consecuencias. Una decisión nueva que cambia otra se registra como ADR propio y se enlaza desde el estado del anterior.

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-monorepo.md) | Monorepo con web y API separadas | Aceptada |
| [0002](0002-hexagonal-api.md) | API con arquitectura hexagonal | Aceptada |
| [0003](0003-feature-sliced-web.md) | Web con Feature-Sliced Design | Aceptada, ajustada por 0013 |
| [0004](0004-pydantic-ai-agents.md) | Agentes con Pydantic AI | Aceptada |
| [0005](0005-langgraph-orchestration.md) | Orquestación con LangGraph | Aceptada |
| [0006](0006-model-providers-and-fallback.md) | Proveedores de modelos y respaldo | Aceptada |
| [0007](0007-neon-postgres-schemas.md) | Base de datos: Neon Postgres con esquemas separados | Aceptada |
| [0008](0008-better-auth-and-api-jwt.md) | Autenticación con Better Auth y JWT para la API | Aceptada |
| [0009](0009-cloud-run-and-vercel.md) | Despliegue: Cloud Run para la API y Vercel para la web | Aceptada |
| [0010](0010-python-environment-uv.md) | Entorno Python con uv | Aceptada |
| [0011](0011-sse-typed-events.md) | Streaming con SSE y eventos tipados | Aceptada |
| [0012](0012-office-view-react-three-fiber.md) | Vista oficina con React Three Fiber | Aceptada |
| [0013](0013-nextjs-routes-outside-src.md) | Rutas de Next.js fuera de `src/` | Aceptada |
| [0014](0014-nonce-based-csp.md) | CSP estricta con nonce en `proxy.ts` | Aceptada |
