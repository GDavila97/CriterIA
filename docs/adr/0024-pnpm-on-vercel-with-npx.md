# 0024. pnpm fijado con npx en Vercel

**Estado:** aceptada (13 nov 2026). Complementa la [0022](0022-production-deployment.md).

**Contexto:** la web fija pnpm en `packageManager` de `apps/web/package.json`, y el lockfile de pnpm 12 tiene dos documentos YAML. El primer despliegue en Vercel avisó `Could not enable corepack because package.json is missing "packageManager" property` y usó el pnpm 10 de su imagen, que falló con `ERR_PNPM_BROKEN_LOCKFILE`. Vercel solo lee `packageManager` del `package.json` de la raíz del repositorio, y aquí la raíz no tiene uno. Además, Node 26 ya no trae Corepack.

**Decisión:**

- `apps/web/vercel.json` instala y compila con `npx --yes pnpm@<versión>`, la misma versión de `packageManager`.
- El CI falla si los comandos de `vercel.json` no empiezan con la versión de `packageManager`.
- No se crea un `package.json` en la raíz ni se define `ENABLE_EXPERIMENTAL_COREPACK`.

**Alternativas:**

- **`package.json` en la raíz con `packageManager`:** dos fuentes de la versión, y un archivo de Node en la raíz de un monorepo sin espacio de trabajo de JavaScript.
- **Corepack con `ENABLE_EXPERIMENTAL_COREPACK`:** depende de que la imagen de Vercel traiga Corepack, algo que no documenta para Node 26.

**Consecuencias:** la versión de pnpm vive en dos lugares, y el CI los mantiene iguales. Cuando Dependabot sube `packageManager`, el CI falla hasta que se actualice `vercel.json` en el mismo cambio. Cada build descarga pnpm con npx, unos segundos más.
