# 0018. Ciclo de la corrida ligado al stream SSE

**Estado:** aceptada (5 nov 2026). Complementa la [0005](0005-langgraph-orchestration.md) y la [0011](0011-sse-typed-events.md).

**Contexto:** Cloud Run solo asigna CPU mientras hay una petición abierta, así que un grafo que siguiera trabajando en segundo plano después de responder quedaría congelado o se perdería al escalar a cero. Una corrida dura minutos, se detiene en la pausa humana y el cliente puede desconectarse en cualquier momento.

**Decisión:**

- `POST /runs` valida la entrada, resuelve proveedor, modelo y clave, reserva el cupo y guarda la corrida. No llama a ningún modelo; responde el `run_id` y el costo estimado.
- `GET /runs/{id}/stream` es la única petición que ejecuta el grafo. Avanza desde el último checkpoint y emite los eventos hasta `en_espera_humano` o `corrida_fin`, y entonces cierra.
- `POST /runs/{id}/approval` solo guarda la respuesta humana. El siguiente `GET /runs/{id}/stream` reanuda con ella.
- Cada evento se guarda en `app.run_event` antes de enviarse. Al reconectar con `Last-Event-ID`, la API reenvía los posteriores y continúa. `seq` sigue la secuencia guardada, así que no depende de la instancia.
- Si el cliente se desconecta, la ejecución se cancela y la corrida queda en su último checkpoint. El nodo que estaba en curso se repite en el siguiente stream y vuelve a emitir su `agente_inicia`.
- Un solo stream activo por corrida, con un advisory lock de Postgres que se libera solo si la conexión cae. Un segundo stream recibe 409.
- Al terminar, se borran los checkpoints, los eventos y la fila de la corrida. Si el usuario tiene `save_history` activo en ese momento, el resultado se copia antes a `app.saved_run`.
- Una corrida sin actividad durante `RUN_TTL_MINUTES` (60 por defecto) se considera abandonada. La limpieza es oportunista: cada `POST /runs` borra las abandonadas, sin cron.
- Mientras un agente trabaja, el stream envía un comentario SSE (`: ping`) cada 15 s para que ningún intermediario cierre la conexión por inactividad.

**Alternativas:** ejecutar en segundo plano y que el stream solo lea (en Cloud Run exige CPU siempre asignada, con costo); una cola con workers (otro servicio que operar); WebSockets (bidireccional innecesario, ya descartado en la 0011).

**Consecuencias:** la corrida avanza solo mientras alguien la mira, algo coherente con la pausa humana. El tiempo de espera de Cloud Run debe cubrir el tramo más largo entre pausas. Un cliente que pierde la conexión justo después de `corrida_fin` ya no puede volver a pedirlo, salvo que la corrida haya quedado en el historial.
