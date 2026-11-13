# 0023. Conexiones que Neon cierra al suspender el cómputo

**Estado:** aceptada (13 nov 2026). Complementa la [0007](0007-neon-postgres-schemas.md) y la [0018](0018-run-lifecycle-bound-to-the-stream.md).

**Contexto:** Neon suspende el cómputo tras unos 5 minutos sin uso y cierra todas las sesiones. En producción, la primera petición después de una suspensión tomaba del pool una conexión ya cerrada y recibía `terminating connection due to administrator command`. `POST /runs` fallaba con un 500. Además, ese 500 salía sin cabeceras CORS, porque el manejador de Starlette para `Exception` corre fuera de los middlewares, y el navegador lo mostraba como un error de CORS. Una limpieza oportunista que fallaba también tumbaba la creación del análisis, y una reserva de cupo podía quedar tomada sin un análisis guardado.

**Decisión:**

- **Pool de SQLAlchemy:** comprueba cada conexión al sacarla (`pool_pre_ping`) y la reemplaza a los 240 s (`pool_recycle`), antes de la suspensión.
- **Pool de psycopg de los checkpoints:** comprueba cada conexión al entregarla (`check_connection`) y cierra las que pasan 240 s sin uso (`max_idle`).
- **Lock del stream:** si Neon cierra la sesión que lo tenía, el servidor ya soltó el lock; liberarlo no falla y el stream termina sin error.
- **Limpieza oportunista:** si falla al crear un análisis, se registra en el log y en Sentry, y el análisis se crea igual.
- **Cupo:** si el análisis no se puede guardar después de reservar, la reserva se devuelve.
- **Errores no manejados:** un middleware dentro de CORS responde `error_interno` con las cabeceras de `WEB_ORIGIN`, así que la web ve el error real.
- Las pruebas de integración lo comprueban terminando las sesiones de `api_role` con `pg_terminate_backend`.

**Alternativas:**

- **Desactivar la suspensión de Neon:** exige un plan de pago y mantiene el cómputo encendido sin tráfico.
- **Reintentar la petición completa:** repite efectos como la reserva de cupo y esconde el error real.
- **Usar el pooler de Neon en la API:** el pooler trabaja por transacción y no conserva el advisory lock de sesión del stream.

**Consecuencias:** la primera petición después de una suspensión tarda lo que Neon tarda en reactivar el cómputo, pero no falla. Cada préstamo de conexión hace una consulta de comprobación. Un error de la API siempre llega a la web con su código, incluso dentro de un 500.
