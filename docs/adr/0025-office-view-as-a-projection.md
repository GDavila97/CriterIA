# 0025. Vista oficina como proyección del estado, en SVG y DOM

**Estado:** aceptada (13 nov 2026). Sustituye la [0012](0012-office-view-react-three-fiber.md).

**Contexto:** la 0012 planeaba la oficina con React Three Fiber. El mockup aprobado en F9 (artboard 7) es una escena isométrica plana con cuatro zonas, agentes con globos, contadores y un registro, y no pide profundidad real ni cámara. La oficina debe mostrar el mismo análisis que la vista clásica, sin endpoints ni eventos nuevos, sin pesar en la vista clásica ni en PageSpeed, con movimiento reducido y con la CSP estricta de la [0014](0014-nonce-based-csp.md).

**Decisión:**

- **Proyección pura.** `projectOffice(state, nombre)` (`widgets/vista-oficina/model/projection.ts`) convierte el `RunState` de la entidad `corrida` en el momento (inactivo, durante, tu turno, terminado, detenido) y, por agente, la actividad, el lugar donde debe estar (su trabajo o el tablero), el globo y si está libre para su rutina. Los globos salen de los eventos: la ronda, las referencias de las observaciones del Revisor ("Corrigiendo CP-09") y sus destinos ("Pide corrección a QA"). La clásica y la oficina leen el mismo estado.
- **Escena en SVG, agentes en DOM.** La sala es un solo `<svg>` con unos 60 polígonos calculados una vez (`model/layout.ts`), memorizado y con `aria-hidden`. Escala con su `viewBox` sin recalcular nada. Cada agente es un botón HTML encima, solo para el mouse.
- **Control accesible equivalente.** La escena lleva `aria-hidden` y sus botones `tabindex="-1"`. La fila «Agentes» bajo la escena, con un botón de 44 px por agente («QA · escribiendo casos de prueba»), abre el mismo panel. Cuando dos agentes se cruzan al caminar, sus botones se enciman; WCAG 2.5.8 (Target Size, Minimum) lo admite por la excepción «Equivalent», porque la fila hace lo mismo con objetivos de tamaño suficiente. axe excluye solo esos botones y solo de `target-size` y `target-offset` ([audit-exceptions.md](../audit-exceptions.md)).
- **Rutina.** Los agentes libres siguen una rutina con pesos: su escritorio, la sala de descanso, platicar en pareja, la sala de juntas o el tablero. Al terminar un análisis se juntan a celebrar y después la retoman. `model/life.ts` es una simulación de eventos con semilla y tiempo inyectado: decide actividades, reserva lugares (nunca dos agentes en el mismo) y organiza charlas y celebración. Así se prueba sin navegador y la misma semilla repite la misma escena. El reloj solo avanza con la pestaña visible.
- **Movimiento.** Las rutas pasan por puntos de los pasillos para no cruzar muebles. Cada tramo es una transición de `transform` a velocidad constante, con arranque y frenado suaves; el agente mira hacia donde camina, anda, rebota y se asienta al llegar. En reposo respira y cambia de peso. Con `prefers-reduced-motion` no hay rutina ni animaciones.
- **Tu turno.** El Analista va al tablero con papeles y llama a la persona por su nombre de pila con un globo ámbar. La tarjeta "Las historias están listas para tu revisión" abre la misma aprobación de la vista clásica en un cajón, y una región `aria-live` anuncia el turno y el final.
- **Carga y acceso.** El código de la oficina se carga con `next/dynamic` (`ssr: false`) solo al elegirla. El interruptor aparece con `NEXT_PUBLIC_OFFICE_VIEW=true` y 768 px o más; por debajo, `?vista=oficina` cae a la clásica. La preferencia se guarda en `localStorage`, con `try/catch`.
- **CSP.** La posición de cada agente se aplica desde React en el cliente, como propiedades de estilo del DOM; no hay atributos `style` en el HTML del servidor ni `'unsafe-inline'`.

**Alternativas:**

- **React Three Fiber (0012):** agrega Three.js a la descarga de la oficina, exige un respaldo sin WebGL y deja los agentes fuera del árbol accesible, para una escena que no necesita 3D.
- **DOM con `clip-path`, como el mockup:** un elemento posicionado por polígono, más nodos y más trabajo de diseño al cambiar el tamaño.
- **Canvas 2D:** se dibuja en cada cuadro y los agentes tendrían que duplicarse como botones para ser accesibles.
- **Eventos o endpoints propios de la oficina:** dos fuentes de verdad para lo mismo.

**Consecuencias:** la oficina es un chunk aparte de unos 12 kB que la vista clásica no carga. Su lógica se prueba sin navegador: la proyección por momento, la rutina por eventos y el reloj con temporizadores falsos. La escena es para el mouse y la fila de agentes es el control accesible, lo que explica la única excepción de axe del proyecto. Activarla en producción es un cambio de variable de build (`NEXT_PUBLIC_OFFICE_VIEW=true`) y un despliegue nuevo de la web. La escena es ilustración: en modo oscuro se atenúa con un filtro, sin una paleta propia.
