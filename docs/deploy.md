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

El script crea `migrator_role`, `api_role`, `eval_writer` y `web_role` con `LOGIN` y sin contraseña, y los esquemas `app` y `graph` (de `migrator_role`) y `auth` (de `web_role`). Le da al dueño de la base `SET` e `INHERIT` sobre `migrator_role` y `web_role`, porque en Postgres 16 quien crea un rol sin ser superusuario solo recibe `ADMIN` y no puede entregarle esquemas. También fija `search_path=auth` en `web_role`, porque el pooler de Neon trabaja por transacción y no conserva opciones por conexión. Después se asigna a cada rol una contraseña larga y aleatoria, distinta por rol, que se guarda en 1Password:

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
| `USER_RUNS_PER_HOUR`, `USER_RUNS_PER_DAY`, `GLOBAL_DAILY_RUNS`, `GLOBAL_DAILY_BUDGET_USD` | Variables de Cloud Run | Por defecto: 5 corridas por hora y 20 por día por usuario; tope global diario de 25 corridas y 0.09 USD con la clave del servidor, para que el límite de gasto mensual de 3 USD de Groq no se agote a mitad de mes (31 × 0.09 = 2.79 USD). Con el precio verificado de `openai/gpt-oss-20b` y su perfil de consumo calibrado en la evaluación v1, cada corrida reserva unos 0.008 USD, así que el tope en dólares cierra el modo gratuito tras unas 10 corridas, antes que el de corridas |
| `RUN_TTL_MINUTES`, `SSE_HEARTBEAT_SECONDS`, `MAX_REQUEST_BYTES`, `PROVIDER_TIMEOUTS` | Variables de Cloud Run | Valores por defecto salvo motivo |
| `AUTH_REQUIRE_VERIFIED_EMAIL` | Variable de Cloud Run | `false` mientras la web tenga `EMAIL_PROVIDER=none` ([ADR 0020](adr/0020-github-first-sign-in-without-email.md)); `true` al tener dominio y envío |
| `MODEL_BACKEND` | — | Siempre `real` (el valor por defecto); `fake` solo existe para las pruebas y la API no arranca con él fuera de `APP_ENV=test` |

Web (Vercel):

| Variable | Dónde vive | Nota |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OFFICE_VIEW` | Variables de Vercel | Se incrustan en el build; la URL de la API en `https` |
| `NEXT_PUBLIC_CONTACT_URL` | Variable de Vercel | Contacto de "Privacidad y datos": un perfil en `https` o un `mailto:`; vacía usa `https://github.com/GDavila97` |
| `BETTER_AUTH_SECRET` | Variable secreta de Vercel | 32 o más caracteres aleatorios; también cifra la llave privada del JWKS, así que cambiarlo obliga a regenerarla |
| `BETTER_AUTH_URL` | Variable de Vercel | Origen público de la web; con `https` en producción |
| `AUTH_DATABASE_URL` | Variable secreta de Vercel | `web_role`, URL con pooler de Neon (Better Auth no usa locks de sesión) |
| `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` | Variables de Vercel | Vacías usan `BETTER_AUTH_URL`; deben coincidir con `AUTH_ISSUER` y `AUTH_AUDIENCE` de la API |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | Variables de Vercel | `none` hasta tener dominio; después `resend` con la clave como secreto |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Variables de Vercel (el secreto como secreto) | De la OAuth App de producción |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Vacías: Google queda preparado sin botón |

### OAuth App de GitHub (F6)

En GitHub, Settings > Developer settings > OAuth Apps, una app distinta para producción (la de desarrollo apunta a `localhost`):

- Homepage URL: el origen de la web en Vercel.
- Authorization callback URL: `https://<origen de la web>/api/auth/callback/github`.
- No pide permisos más allá de `user:email`; los tokens de GitHub no se guardan.

### Rotación de la llave de las claves

1. Agregar la versión nueva a `CREDENTIALS_KEYS` (`1:…,2:…`) sin cambiar `CREDENTIALS_ACTIVE_KEY` y desplegar.
2. Cambiar `CREDENTIALS_ACTIVE_KEY=2` y desplegar: las claves nuevas se cifran con la 2 y las viejas se siguen leyendo con la 1.
3. Retirar la versión 1 solo cuando ninguna fila la use (`SELECT count(*) FROM app.provider_credential WHERE key_version = 1`). Las claves que no se pueden descifrar se tratan como inexistentes y el usuario debe guardarlas de nuevo.

## Migraciones

El orden importa: primero las de Better Auth (crean `auth."user"`) y después las de la API, porque la migración 0004 agrega llaves foráneas hacia esa tabla.

1. Better Auth, desde `apps/web` con el mismo SHA y como `web_role`:

   ```bash
   AUTH_DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... NEXT_PUBLIC_APP_ENV=production pnpm auth:migrate
   ```

   Las tablas quedan a nombre de `web_role`, y los privilegios por defecto de `roles.sql` dan a `migrator_role` solo `REFERENCES` sobre ellas, nunca lectura.

2. API, siempre antes de desplegarla, con la imagen del mismo SHA y `MIGRATION_DATABASE_URL`:

```bash
docker run --rm -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" <imagen> alembic upgrade head
```

La primera migración crea las tablas de `app`, la segunda aplica las migraciones del checkpointer de LangGraph en `graph` la tercera agrega `app.run.settled`, que evita ajustar dos veces el cupo de una corrida, y la cuarta liga cada `user_id` de `app` a `auth."user"` con borrado en cascada y guarda los planes por agente y la decisión de historial de cada corrida. La API no ejecuta DDL: si los checkpoints no están en la última versión, se niega a arrancar. Al actualizar `langgraph-checkpoint-postgres` hay que agregar una migración de Alembic que vuelva a correr sus migraciones. En F6 este paso se vuelve un job manual de Cloud Run con environment protegido, junto con las migraciones de Better Auth (esquema `auth`).

## API en Cloud Run

Pendiente: build y push de la imagen del SHA verificado, despliegue con máximo 2 instancias, cuenta de servicio y secretos. El tiempo de espera de la petición debe cubrir el tramo más largo de una corrida entre pausas, porque el grafo solo avanza con el stream abierto ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)); 15 minutos dan margen sobre lo medido en F2b.

## Web en Vercel

Pendiente: despliegue manual del mismo SHA y variables de producción.

Los límites de Better Auth por IP leen solo `x-forwarded-for`, del que la ruta `/api/auth` conserva la primera dirección. Vercel documenta que sobrescribe esa cabecera con la IP del cliente para evitar suplantación; de `x-real-ip` no lo promete.

## Verificación posterior

Pendiente. Checklist de cierre: teléfono real (iPhone, 390 px), cabeceras de seguridad, CORS, límite de uso con dos cuentas, flujo completo de registro y verificación, PageSpeed y alerta de presupuesto activa.

## Reversión

Pendiente.
