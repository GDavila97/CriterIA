# 0011. Streaming con SSE y eventos tipados

**Estado:** aceptada.

**Contexto:** la interfaz muestra en vivo qué hace cada agente, en dos vistas distintas.

**Decisión:** Server-Sent Events desde la API, con eventos definidos como modelos Pydantic (tabla de la sección 5 del plan) y tipos TypeScript generados. Cada evento lleva `run_id`, `seq` y `ts`; el cliente descarta duplicados por `seq` y puede reconectarse con `Last-Event-ID`. Ninguna vista interpreta eventos por su cuenta: una entidad `corrida` en la web reduce los eventos a estado.

**Alternativas:** WebSockets (bidireccional innecesario, más complejo en Cloud Run); sondeo (latencia y costo).

**Consecuencias:** la vista clásica y la oficina muestran siempre lo mismo. Hay que configurar el tiempo de espera de Cloud Run para corridas largas.
