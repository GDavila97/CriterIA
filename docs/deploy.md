# Despliegue

> Esqueleto. Se completa en F6 con los valores reales; ningún paso de esta guía corre desde GitHub Actions.

Todos los despliegues son manuales ([ADR 0009](adr/0009-cloud-run-and-vercel.md)). Secuencia: push → CI verde → migraciones → API → web, siempre con el mismo SHA.

## Requisitos previos

- Proyecto de GCP con facturación, alerta de presupuesto de 1 dólar y región `us-central1`.
- Artifact Registry para la imagen de la API.
- Secret Manager con los secretos de la API, cargados desde 1Password.
- Proyecto de Vercel con `deploymentEnabled.main: false`.
- Base de Neon de producción con los roles `web_role`, `api_role`, `migrator_role` y `eval_writer`.

## Roles de la base

Una sola vez por base (y de nuevo si cambia el script, que es idempotente), con el rol dueño de la base (`neondb_owner` en Neon):

```bash
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f services/api/db/roles.sql
```

El script crea `migrator_role`, `api_role`, `eval_writer` y `web_role` con `LOGIN` y sin contraseña, y los esquemas `app` y `graph` (de `migrator_role`) y `auth` (de `web_role`). Después se asigna a cada rol una contraseña larga y aleatoria, distinta por rol, que se guarda en 1Password:

```sql
ALTER ROLE migrator_role PASSWORD '…';
ALTER ROLE api_role PASSWORD '…';
ALTER ROLE eval_writer PASSWORD '…';
ALTER ROLE web_role PASSWORD '…';
```

En Neon la conexión exige `sslmode=require`. La API y las migraciones usan la URL directa, sin `-pooler`: el lock del stream es un advisory lock de sesión y el pooler en modo transacción no lo conserva. Cada instancia abre hasta 30 conexiones (`DATABASE_POOL_SIZE` 10, más 10 de desborde y 10 para los checkpoints), así que dos instancias quedan dentro del límite de conexiones de Neon.

## Variables y secretos

Parten de `services/api/.env.example` y `apps/web/.env.example`. Lo que falta de la web se completa en F4 y F6.

| Variable | Dónde vive | Nota |
| --- | --- | --- |
| `DATABASE_URL` | Secret Manager | `api_role`, URL directa de Neon |
| `MIGRATION_DATABASE_URL` | Secret Manager, solo para el job de migraciones | `migrator_role`, URL directa |
| `CREDENTIALS_KEYS`, `CREDENTIALS_ACTIVE_KEY` | Secret Manager | 32 bytes aleatorios por versión; perder la llave hace ilegibles las claves guardadas |
| `GROQ_API_KEY` | Secret Manager | Única clave de proveedor en producción |
| `SENTRY_DSN` | Secret Manager | |
| `WEB_ORIGIN`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` | Variables de Cloud Run | Origen exacto de la web en Vercel |
| `SERVER_KEY_PROVIDERS=groq`, `APP_ENV=production` | Variables de Cloud Run | |
| `USER_RUNS_PER_HOUR`, `USER_RUNS_PER_DAY`, `GLOBAL_DAILY_RUNS`, `GLOBAL_DAILY_BUDGET_USD` | Variables de Cloud Run | Los topes globales se fijan con los precios verificados de Groq (F5) |
| `RUN_TTL_MINUTES`, `SSE_HEARTBEAT_SECONDS`, `MAX_REQUEST_BYTES`, `PROVIDER_TIMEOUTS` | Variables de Cloud Run | Valores por defecto salvo motivo |

### Rotación de la llave de las claves

1. Agregar la versión nueva a `CREDENTIALS_KEYS` (`1:…,2:…`) sin cambiar `CREDENTIALS_ACTIVE_KEY` y desplegar.
2. Cambiar `CREDENTIALS_ACTIVE_KEY=2` y desplegar: las claves nuevas se cifran con la 2 y las viejas se siguen leyendo con la 1.
3. Retirar la versión 1 solo cuando ninguna fila la use (`SELECT count(*) FROM app.provider_credential WHERE key_version = 1`). Las claves que no se pueden descifrar se tratan como inexistentes y el usuario debe guardarlas de nuevo.

## Migraciones

Siempre antes de desplegar la API, con la imagen del mismo SHA y `MIGRATION_DATABASE_URL`:

```bash
docker run --rm -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" <imagen> alembic upgrade head
```

La primera migración crea las tablas de `app`, la segunda aplica las migraciones del checkpointer de LangGraph en `graph` y la tercera agrega `app.run.settled`, que evita ajustar dos veces el cupo de una corrida. La API no ejecuta DDL: si los checkpoints no están en la última versión, se niega a arrancar. Al actualizar `langgraph-checkpoint-postgres` hay que agregar una migración de Alembic que vuelva a correr sus migraciones. En F6 este paso se vuelve un job manual de Cloud Run con environment protegido, junto con las migraciones de Better Auth (esquema `auth`).

## API en Cloud Run

Pendiente: build y push de la imagen del SHA verificado, despliegue con máximo 2 instancias, cuenta de servicio y secretos. El tiempo de espera de la petición debe cubrir el tramo más largo de una corrida entre pausas, porque el grafo solo avanza con el stream abierto ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)); 15 minutos dan margen sobre lo medido en F2b.

## Web en Vercel

Pendiente: despliegue manual del mismo SHA y variables de producción.

## Verificación posterior

Pendiente. Checklist de cierre: teléfono real (iPhone, 390 px), cabeceras de seguridad, CORS, límite de uso con dos cuentas, flujo completo de registro y verificación, PageSpeed y alerta de presupuesto activa.

## Reversión

Pendiente.
