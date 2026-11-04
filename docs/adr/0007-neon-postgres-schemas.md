# 0007. Base de datos: Neon Postgres con esquemas separados

**Estado:** aceptada.

**Contexto:** se persisten usuarios (Better Auth), checkpoints del grafo, límites de uso, historial opcional y resultados de evaluación. Los proyectos gratuitos de Supabase ya están ocupados.

**Decisión:** Neon Postgres en capa gratuita. Esquemas `auth` (Better Auth, sus migraciones), `app` (Alembic) y `graph` (checkpointer). Roles con mínimo privilegio: `web_role`, `api_role`, `migrator_role` y `eval_writer`. Artefactos y puntajes en `jsonb` validado por esquema en la API.

**Alternativas:** documentos (MongoDB): las métricas de evaluación se comparan mejor con SQL; SQLite: no sirve con varias instancias de Cloud Run.

**Consecuencias:** dos sistemas de migración sobre una base, separados por esquema. La base gratuita se suspende sin uso; el primer acceso tarda un poco más.
