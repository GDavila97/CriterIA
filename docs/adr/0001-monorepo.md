# 0001. Monorepo con web y API separadas

**Estado:** aceptada.

**Contexto:** el núcleo de IA va en Python y la interfaz en Next.js. Un solo desarrollador, un solo CI y un contrato de eventos compartido.

**Decisión:** un repositorio con `apps/web` (Next.js) y `services/api` (Python). Sin herramientas de monorepo (Turborepo, Nx): cada parte usa su gestor (pnpm y uv) y el CI tiene un job por parte. El contrato se genera desde los esquemas Pydantic y se versiona en `apps/web/src/shared/api/types.gen.ts`.

**Alternativas:** dos repositorios (historial y CI duplicados, contrato desincronizado); Turborepo (no aporta con un solo paquete JS).

**Consecuencias:** un commit puede cambiar API y web a la vez con el contrato al día. El CI debe filtrar jobs por ruta cuando crezca.
