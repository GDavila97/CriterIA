# 0026. Conversación del equipo a partir de los eventos guardados

**Estado:** aceptada (15 nov 2026).

**Contexto:** F10 pide mostrar cómo trabajaron los agentes ("Así trabajó el equipo"): quién entregó qué a quién, las correcciones del Revisor y la aprobación de la persona, en la vista clásica, en la oficina y en el detalle del historial. En vivo la web ya recibe todos los eventos por SSE, pero el historial solo guardaba los artefactos finales, sin rondas ni orden, y al terminar una corrida sus eventos se borran ([ADR 0018](0018-run-lifecycle-bound-to-the-stream.md)).

**Decisión:**

- **Guardar los eventos con la corrida.** Al copiarla al historial, `app.saved_run.events` (`jsonb`) guarda los eventos que la persona recibió por SSE, ya sanitizados y sin heartbeats, y `events_version` (entero, hoy `1`) dice su formato. Una prueba de integración comprueba que no contienen claves ni datos de otros usuarios.
- **Tope de 512 KB.** Si se excede, la corrida se guarda sin eventos, el log lo registra y el guardado no falla.
- **Compatibilidad.** La migración 0006 agrega ambas columnas nulas, así que la versión anterior de la API sigue guardando. Las corridas guardadas antes no tienen eventos y la web oculta la sección, sin error. Los eventos se borran en cascada con la corrida guardada y con la cuenta. "Qué guardamos", en Privacidad y datos, lo dice.
- **Mensajes en la web, con una función pura.** `teamMessages(eventos)` arma cada mensaje (de, para, tipo, ronda, texto, texto corto, título, subtítulo y referencias) sin eventos ni endpoints nuevos. El orden es el del grafo real (Analista → Tú → QA → Revisor → correcciones → Evaluador), no el del mockup. La web solo reconstruye la conversación si conoce `events_version`.
- **Las mismas piezas en todos lados.** La lista, el diagrama de carriles (`diagramLayout`, también puro) y los globos de la oficina usan los mismos mensajes. El detalle del historial reproduce los eventos con el mismo reductor que la vista en vivo, así que muestra las rondas igual que al terminar.
- **Borrar uno.** `DELETE /me/runs/{id}` borra una corrida guardada, para el botón Eliminar del detalle.

**Alternativas:**

- **Un resumen por rondas calculado en la API:** otra forma de los mismos datos que habría que versionar aparte y que la vista en vivo no tendría.
- **Reconstruir desde los artefactos finales:** pierde las rondas, las correcciones y la aprobación.
- **Guardar los checkpoints de LangGraph:** guardan el estado interno del grafo, no lo que la persona vio, y pesan mucho más.

**Consecuencias:** el historial ocupa más, hasta el tope de 512 KB por análisis. Cambiar la forma de los eventos obliga a subir `events_version` y a enseñar a la web la versión nueva; mientras tanto, la sección se oculta en esos análisis. El texto de los mensajes vive en la web y se prueba con Vitest, sin modelos.
