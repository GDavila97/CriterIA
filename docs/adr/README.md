# Registro de decisiones de arquitectura

Cada ADR sigue el formato Estado, Contexto, Decisión, Alternativas y Consecuencias. Una decisión nueva que cambia otra se registra como ADR propio y se enlaza desde el estado del anterior.

| ADR                                                | Decisión                                                                      | Estado                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| [0001](0001-monorepo.md)                           | Monorepo con web y API separadas                                              | Aceptada                           |
| [0002](0002-hexagonal-api.md)                      | API con arquitectura hexagonal                                                | Aceptada                           |
| [0003](0003-feature-sliced-web.md)                 | Web con Feature-Sliced Design                                                 | Aceptada, ajustada por 0013        |
| [0004](0004-pydantic-ai-agents.md)                 | Agentes con Pydantic AI                                                       | Aceptada, ajustada por 0015 y 0017 |
| [0005](0005-langgraph-orchestration.md)            | Orquestación con LangGraph                                                    | Aceptada                           |
| [0006](0006-model-providers-and-fallback.md)       | Proveedores de modelos y respaldo                                             | Aceptada, ajustada por 0016        |
| [0007](0007-neon-postgres-schemas.md)              | Base de datos: Neon Postgres con esquemas separados                           | Aceptada, complementada por 0023   |
| [0008](0008-better-auth-and-api-jwt.md)            | Autenticación con Better Auth y JWT para la API                               | Aceptada, ajustada por 0020        |
| [0009](0009-cloud-run-and-vercel.md)               | Despliegue: Cloud Run para la API y Vercel para la web                        | Aceptada, concretada por 0022      |
| [0010](0010-python-environment-uv.md)              | Entorno Python con uv                                                         | Aceptada                           |
| [0011](0011-sse-typed-events.md)                   | Streaming con SSE y eventos tipados                                           | Aceptada                           |
| [0012](0012-office-view-react-three-fiber.md)      | Vista oficina con React Three Fiber                                           | Sustituida por 0025                |
| [0013](0013-nextjs-routes-outside-src.md)          | Rutas de Next.js fuera de `src/`                                              | Aceptada                           |
| [0014](0014-nonce-based-csp.md)                    | CSP estricta con nonce en `proxy.ts`                                          | Aceptada                           |
| [0015](0015-frozen-judge-prompt.md)                | Juez con versión propia y congelado                                           | Aceptada                           |
| [0016](0016-claves-por-usuario.md)                 | Claves de API por usuario y Groq gratuito por defecto                         | Aceptada, ajustada por 0019        |
| [0017](0017-native-output-for-local-models.md)     | Salida JSON nativa para los modelos locales                                   | Aceptada, extendida por 0021       |
| [0018](0018-run-lifecycle-bound-to-the-stream.md)  | Ciclo de la corrida ligado al stream SSE                                      | Aceptada, complementada por 0023   |
| [0019](0019-groq-developer-for-the-free-mode.md)   | Modo gratuito sobre el plan Developer de Groq                                 | Aceptada                           |
| [0020](0020-github-first-sign-in-without-email.md) | GitHub como acceso principal mientras no se envían correos                    | Aceptada                           |
| [0021](0021-native-output-for-gpt-oss-on-groq.md)  | Salida JSON nativa para gpt-oss-20b en Groq                                   | Aceptada                           |
| [0022](0022-production-deployment.md)              | Despliegue de producción: imagen local, pooler para la web y Cloud Run medido | Aceptada, complementada por 0024   |
| [0023](0023-connections-closed-by-neon.md)         | Conexiones que Neon cierra al suspender el cómputo                            | Aceptada                           |
| [0024](0024-pnpm-on-vercel-with-npx.md)            | pnpm fijado con npx en Vercel                                                 | Aceptada                           |
| [0025](0025-office-view-as-a-projection.md)        | Vista oficina como proyección del estado, en SVG y DOM                        | Aceptada                           |
