# 0003. Web con Feature-Sliced Design

**Estado:** aceptada; ajustada por la [0013](0013-nextjs-routes-outside-src.md) (rutas de Next.js fuera de `src/`).

**Contexto:** la web tiene dos presentaciones del mismo estado (vista clásica y oficina), auth, historial y tablero.

**Decisión:** FSD con capas `app`, `pages`, `widgets`, `features`, `entities`, `shared`. Las vistas son widgets que consumen la misma entidad `corrida`, alimentada por un único cliente SSE. Las rutas de Next.js viven en `src/app` y solo componen páginas.

**Alternativas:** estructura por tipo de archivo (se desordena al crecer); solo App Router sin capas (mezcla lógica y presentación).

**Consecuencias:** la oficina se agrega en F9 sin tocar la lógica de la corrida. Regla de importación entre capas verificada con ESLint.
