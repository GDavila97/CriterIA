# 0013. Rutas de Next.js fuera de `src/`

**Estado:** aceptada (4 nov 2026). Ajusta la [0003](0003-feature-sliced-web.md).

**Contexto:** la 0003 colocaba las rutas de Next.js en `src/app` junto a la capa FSD `src/pages`. Next.js busca las carpetas `app` y `pages` por separado, primero en la raíz del proyecto y luego en `src/`: si existen `src/app` y `src/pages`, trata `src/pages` como Pages Router y convierte cada slice en una ruta; si las rutas están en la raíz y `src/pages` existe, el build falla con "`pages` and `app` directories should be under the same folder".

**Decisión:** seguir la guía oficial de FSD para Next.js.

- Las rutas del App Router viven en `apps/web/app/`. Son delgadas: solo reexportan componentes de `src/app` (layout raíz) y de `src/pages` (páginas), además de archivos de convención como `icon.svg`.
- `apps/web/pages/` existe vacía, con un `README.md` que explica por qué, para que Next.js no tome `src/pages` como Pages Router.
- `src/` es FSD completo: `app` (layout raíz, providers, fuentes y estilos globales), `pages`, `widgets`, `features`, `entities` y `shared`.
- El alias `@/` apunta a `src/`.
- `eslint-plugin-boundaries` verifica las capas: cada capa importa solo capas inferiores y por su API pública (`index.ts`); los slices de una misma capa no se importan entre sí; `shared` se importa por segmento; nada en `src/` puede importar desde `apps/web/app/`.
- `proxy.ts`, `instrumentation.ts` e `instrumentation-client.ts` quedan en `apps/web/` porque Next.js los busca junto a la carpeta de rutas.

**Alternativas:** renombrar la capa `pages` a `views` y dejar las rutas en `src/app` (se aparta de los nombres estándar de FSD y del plan); `pageExtensions` personalizados (obliga a renombrar también los archivos del App Router).

**Consecuencias:** hay dos carpetas llamadas `app` con papeles distintos (rutas en la raíz, capa FSD en `src/`), documentadas en `docs/architecture.md`. Agregar una ruta implica crear la página en `src/pages/<slice>` y un archivo de una línea en `app/`.
