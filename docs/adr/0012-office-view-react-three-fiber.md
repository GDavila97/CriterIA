# 0012. Vista oficina con React Three Fiber

**Estado:** sustituida por la [0025](0025-office-view-as-a-projection.md) (proyección del estado en SVG y DOM, sin Three.js).

**Contexto:** se quiere una capa visual opcional con los agentes trabajando en una oficina isométrica, sin afectar la vista clásica ni el rendimiento.

**Decisión:** React Three Fiber con primitivas hechas en código (sin modelos externos), cámara ortográfica fija, Fichas construidas con geometrías simples, etiquetas en HTML sobre la escena. Se carga de forma diferida solo al activar la vista. Sin WebGL o con `prefers-reduced-motion`, se muestra la vista clásica o una oficina sin animación.

**Alternativas:** Canvas 2D estilo pixel art (más barato, no coincide con la referencia isométrica); modelos 3D detallados (pesados y lentos de producir).

**Consecuencias:** la vista clásica no carga Three.js. Unos dos días de trabajo en F9.
