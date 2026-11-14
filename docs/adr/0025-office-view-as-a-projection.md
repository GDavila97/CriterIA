# 0025. Vista oficina como proyección del estado, en SVG y DOM

**Estado:** aceptada (13 nov 2026). Sustituye la [0012](0012-office-view-react-three-fiber.md).

**Contexto:** la 0012 planeaba la oficina con React Three Fiber. El mockup aprobado en F9 (artboard 7) es una escena isométrica plana con cuatro zonas, agentes con globos, contadores y un registro, y no pide profundidad real ni cámara. La oficina debe mostrar el mismo análisis que la vista clásica, sin endpoints ni eventos nuevos, sin pesar en la vista clásica ni en PageSpeed, con movimiento reducido y con la CSP estricta de la [0014](0014-nonce-based-csp.md).

**Decisión:**

- **Proyección pura.** `projectOffice(state, nombre)` (`widgets/vista-oficina/model/projection.ts`) convierte el `RunState` de la entidad `corrida` en el momento (inactivo, durante, tu turno, terminado, detenido) y, por agente, la actividad, la zona, el punto, el globo y si está libre. Los globos salen de los eventos: la ronda, las referencias de las observaciones del Revisor ("Corrigiendo CP-09") y sus destinos ("Pide corrección a QA"). La clásica y la oficina leen el mismo estado.
- **Escena en SVG, agentes en DOM.** La sala es un solo `<svg>` con unos 60 polígonos calculados una vez (`model/layout.ts`), memorizado y con `aria-hidden`. Escala con su `viewBox` sin recalcular nada. Cada agente es un botón HTML encima, con `aria-label` que nombra su actividad, para que abra el panel del agente que ya existe y reciba el foco con el teclado.
- **Movimiento.** Al cambiar de zona, el agente se traslada con una transición de `transform` y anda mientras dura; al llegar se detiene. Los agentes libres deambulan entre cinco puntos de la sala de descanso que nunca se enciman y a veces dicen frases cortas de una lista fija. Un programador con semilla (`model/idle.ts`) decide pausas, agente y paso, así que la misma semilla repite la misma escena. Con la pestaña oculta todo se pausa; con `prefers-reduced-motion` nadie camina ni deambula y los globos son fijos.
- **Tu turno.** El Analista va al tablero con papeles y llama a la persona por su nombre de pila con un globo ámbar. La tarjeta "Las historias están listas para tu revisión" abre la misma aprobación de la vista clásica en un cajón, y una región `aria-live` anuncia el turno y el final.
- **Carga y acceso.** El código de la oficina se carga con `next/dynamic` (`ssr: false`) solo al elegirla. El interruptor aparece con `NEXT_PUBLIC_OFFICE_VIEW=true` y 768 px o más; por debajo, `?vista=oficina` cae a la clásica. La preferencia se guarda en `localStorage`, con `try/catch`.
- **CSP.** La posición de cada agente se aplica desde React en el cliente, como propiedades de estilo del DOM; no hay atributos `style` en el HTML del servidor ni `'unsafe-inline'`.

**Alternativas:**

- **React Three Fiber (0012):** agrega Three.js a la descarga de la oficina, exige un respaldo sin WebGL y deja los agentes fuera del árbol accesible, para una escena que no necesita 3D.
- **DOM con `clip-path`, como el mockup:** un elemento posicionado por polígono, más nodos y más trabajo de diseño al cambiar el tamaño.
- **Canvas 2D:** se dibuja en cada cuadro y los agentes tendrían que duplicarse como botones para ser accesibles.
- **Eventos o endpoints propios de la oficina:** dos fuentes de verdad para lo mismo.

**Consecuencias:** la oficina es un chunk aparte de unos 12 kB que la vista clásica no carga. Su lógica se prueba sin navegador: la proyección por momento y el programador con temporizadores falsos. Activarla en producción es un cambio de variable de build (`NEXT_PUBLIC_OFFICE_VIEW=true`) y un despliegue nuevo de la web. La escena es ilustración: en modo oscuro se atenúa con un filtro, sin una paleta propia.
