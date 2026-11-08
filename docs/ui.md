# Interfaz: espaciado y movimiento

Los tokens viven en `apps/web/src/shared/ui/tokens.css`. Ningún módulo CSS usa valores sueltos para `padding`, `margin` o `gap`: si un valor no está en la escala, se ajusta al más cercano.

## Espaciado

| Token | Valor | Uso habitual |
| --- | --- | --- |
| `--space-4` | 4 px | Separación mínima entre icono y texto, desplazamiento de entrada |
| `--space-8` | 8 px | Etiqueta y campo, elementos de una misma fila |
| `--space-12` | 12 px | Ítems de una lista, distancia del chevron al texto del select |
| `--space-16` | 16 px | Relleno horizontal de campos y avisos, entre campos de un formulario |
| `--space-20` | 20 px | Relleno de tarjetas en 390 px |
| `--space-24` | 24 px | Relleno de tarjetas en escritorio, entre tarjetas |
| `--space-32` | 32 px | Entre secciones de una página |
| `--space-40` | 40 px | Margen superior de la página de Privacidad |
| `--space-48` | 48 px | Margen inferior de las páginas |

Forma de los controles:

- Campos, selects y botones miden `--size-control-min` (44 px) de alto; los botones `small` miden 36 px y solo comparten fila con otros botones `small`.
- Los selects usan `appearance: none` y un chevron propio a `--space-16` del borde derecho, con relleno derecho suficiente para que el texto nunca lo toque. Cualquier icono dentro de un campo sigue la misma regla: centrado vertical exacto y distancia constante.
- El icono de un aviso ocupa una caja del alto de la primera línea de texto, así queda alineado con ella aunque el aviso tenga varias líneas.

## Movimiento

| Token | Valor | Uso |
| --- | --- | --- |
| `--duration-fast` | 120 ms | Hover, foco y presión |
| `--duration-base` | 200 ms | Cambio de pestaña, entrada de eventos y artefactos, salida del panel |
| `--duration-slow` | 320 ms | Entrada del panel del agente |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Todo lo que entra |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Todo lo que sale |
| `--motion-shift` | 4 px | Desplazamiento de una entrada |
| `--motion-lift` | -1 px | Elevación de botones al pasar el cursor (las tarjetas usan el doble) |
| `--motion-press` | 0.98 | Escala al presionar |
| `--motion-slide` | 100 % | Recorrido del panel del agente |

Reglas:

- Solo se animan `transform` y `opacity`, para que nada provoque reflujo ni saltos de diseño.
- Las clases compartidas están en `shared/ui/motion`: `enter` (fundido con desplazamiento leve), `fade` y `lift` (tarjetas que se pueden pulsar).
- Mientras cargan datos se muestran esqueletos (`Skeleton`, `SkeletonCard`) con la forma del contenido, nunca un texto que luego empuja la página.
- El panel del agente se desliza desde el borde derecho; al cerrar, incluido con Escape, el diálogo espera a que termine la salida antes de cerrarse.
- Con `prefers-reduced-motion: reduce`, los tokens de distancia valen cero y la escala vale 1: las entradas quedan en un fundido, el panel aparece sin deslizarse, y los bucles (pulso de los esqueletos, parpadeo y balanceo de la Ficha) se detienen.

## Listas largas en la vista de corrida

La página no crece sin límite:

- **Registro.** La tarjeta muestra los últimos 5 eventos y el botón "Ver registro completo (N)" abre un panel lateral (`Drawer`, con el mismo movimiento que el panel del agente) con la línea de tiempo completa y un filtro por agente. El panel lee el mismo estado en vivo, así que la corrida sigue avanzando con el panel abierto: el stream pertenece a la página ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)) y abrirlo no abre otra conexión.
- **Artefactos.** Historias, Casos de prueba, Gherkin y Observaciones se paginan dentro de la tarjeta, 10 por página, con `Paged` (`shared/ui/paged`): "Anterior", "Siguiente" (con `aria-disabled` en los extremos, para no perder el foco) y "Página X de Y" anunciado con `aria-live`. Todas las páginas ocupan la misma celda de la cuadrícula y solo la actual es visible (las demás con `visibility: hidden` e `inert`), de modo que la tarjeta conserva la altura de su página más alta y cambiar de página no mueve nada. La exportación siempre incluye todo.

## Nombres de modelos

La interfaz nunca muestra identificadores como `groq:openai/gpt-oss-20b`. Usa "Proveedor · display_name" ("Groq · GPT-OSS 20B") con el `display_name` del catálogo (`services/api/config/models.toml`), que la API entrega en `GET /catalog`, en el historial y en la evaluación. Los selectores de modelo muestran proveedor y nivel, y el modelo va en una línea secundaria debajo, enlazada con `aria-describedby`, para que la opción nunca se corte.

## Verificación

Las pruebas de pantallas de Playwright (`apps/web/e2e/screens`) corren en escritorio y 390 px, en claro y oscuro. En cada captura esperan a que terminen las animaciones finitas, pasan axe, verifican que no haya violaciones de CSP y, a 390 px, fallan si la página se desborda a lo ancho. Otra prueba confirma que con movimiento reducido los tokens de distancia valen cero.
