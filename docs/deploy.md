# Despliegue

Todos los despliegues son manuales ([ADR 0009](adr/0009-cloud-run-and-vercel.md), [ADR 0022](adr/0022-production-deployment.md)). GitHub Actions solo corre el CI y, a mano y con aprobación, el workflow de migraciones. Secuencia, siempre con el mismo SHA:

```text
push → CI verde → migraciones (workflow manual) → API (Cloud Run) → web (Vercel) → prueba de humo
```

Los secretos van de 1Password directo a cada servicio con `op read`, nunca a archivos, chats ni capturas. En esta guía, `<…>` marca un valor que se pone en el momento; ningún valor real vive en el repositorio.

## Decisiones

| Tema | Decisión | Por qué |
| --- | --- | --- |
| Imagen de la API | Se construye en la Mac para `linux/amd64` con `docker buildx` y se sube a Artifact Registry | Costo cero en GCP y la imagen sale exactamente del SHA verificado. La compilación emulada tardó 79 s. Cloud Build daría 2,500 minutos gratis al mes en `e2-standard-2`, pero exige su API, permisos para su cuenta de servicio y un bucket para el código; ese bucket es multirregional y la capa gratuita de Cloud Storage solo cubre `us-east1`, `us-west1` y `us-central1` |
| CPU y facturación | 1 vCPU, CPU solo durante las peticiones (`--cpu-throttling`), primera generación | Con menos de 1 vCPU, Cloud Run exige concurrencia 1. La primera generación arranca más rápido y admite desde 128 MiB |
| Memoria | 512 MiB | Medido con la imagen `amd64` y modelos simulados: 209 MiB en reposo y 235 MiB de pico con 20 corridas simultáneas |
| Concurrencia | 10 peticiones por instancia, máximo 2 instancias | Cada stream retiene una conexión de la base para su lock ([ADR 0018](adr/0018-run-lifecycle-bound-to-the-stream.md)). Con 20 streams en una instancia se agotó el pool de SQLAlchemy (10 más 10 de desborde) y fallaron 14 de 20; con 10, terminaron 10 de 10 |
| Tiempo límite de petición | 900 s (15 min) | El grafo solo avanza con el stream abierto. En la evaluación v1, una corrida completa tardó como p95 61 s con GPT-OSS 20B y 207 s con Haiku. 15 min dejan margen para las claves de usuario y para los dos intentos por llamada. Google recomienda tolerar reconexiones por encima de 15 min, y la web ya reconecta con `Last-Event-ID` |
| Base de la web | URL con pooler de Neon | Neon recomienda el pooler para funciones serverless. Better Auth no usa locks de sesión, y `search_path=auth` vive en `web_role`, no en la conexión. Las migraciones de Better Auth usan la URL directa |
| Base de la API | URL directa | El lock del stream es un advisory lock de sesión, que el pooler por transacción no conserva |
| IP del cliente | Solo `x-forwarded-for`, primera dirección | Vercel documenta que sobrescribe esa cabecera con la IP del cliente para evitar suplantación; de `x-real-ip` no lo promete |
| Despliegue de la web | Create Deployment en el panel de Vercel con el SHA; `apps/web/scripts/deploy.sh` queda como alternativa con la CLI | Vercel clona de GitHub exactamente ese commit, sin subir nada de la Mac |
| Región de la web | `cle1` (Cleveland) | Junto a Neon en `aws-us-east-2` (Ohio); Neon no tiene regiones en GCP |

### Capa gratuita y costos

Cifras de la tabla de la capa gratuita de Google Cloud ([free-cloud-features](https://cloud.google.com/free/docs/free-cloud-features)), por cuenta de facturación y por mes:

| Servicio | Gratis al mes | Uso previsto |
| --- | --- | --- |
| Cloud Run (facturación por petición) | 2 millones de peticiones, 360,000 GB-segundos, 180,000 vCPU-segundos y 1 GB de salida desde Norteamérica | Una corrida gratuita mantiene el stream abierto alrededor de 1 min: 11 corridas diarias son unos 20,000 vCPU-segundos al mes. Con `--min-instances=0` no hay instancias encendidas sin tráfico |
| Artifact Registry | 0.5 GB de almacenamiento | Unos 110 MB por imagen. La política de limpieza conserva las 3 más recientes |
| Secret Manager | 6 versiones activas de secretos y 10,000 accesos | 4 secretos. Al rotar uno, se destruye la versión anterior |
| Cloud Build | 2,500 minutos de compilación en `e2-standard-2` | No se usa |

Las alertas de presupuesto solo avisan: «doesn't automatically cap Google Cloud […] usage or spending» ([budgets](https://cloud.google.com/billing/docs/how-to/budgets)). Lo que limita el gasto es `--max-instances=2`, la CPU solo durante las peticiones y el tope diario de Groq.

Límites de Cloud Run usados arriba: tiempo límite por defecto de 5 min y máximo de 60 min ([request-timeout](https://cloud.google.com/run/docs/configuring/request-timeout)); con menos de 1 vCPU, «Maximum concurrency must be set to `1`» ([cpu](https://cloud.google.com/run/docs/configuring/services/cpu)); memoria mínima de 128 MiB en primera generación y de 512 MiB en segunda ([memory-limits](https://cloud.google.com/run/docs/configuring/services/memory-limits)).

Rutas reservadas: Cloud Run no deja pasar a la aplicación las rutas que empiezan con `/_ah/` ni algunas que terminan en `z`, y recomienda «avoiding all paths that end in `z`» ([known-issues](https://docs.cloud.google.com/run/docs/known-issues), «Reserved URL paths»). Por eso la ruta de salud es `/health` y no `/healthz`: en producción, `/healthz` respondía un 404 de Google sin llegar a la API. Ninguna ruta nueva de la API debe terminar en `z`.

## Herramientas en la Mac

- `gcloud` (Google Cloud CLI): `gcloud auth login` y `gcloud auth configure-docker us-central1-docker.pkg.dev`.
- Docker Desktop con `buildx`, que ya trae la emulación de `amd64`.
- `gh` con sesión iniciada, `jq`, `psql` (para las contraseñas de Neon) y el CLI de 1Password (`op`).
- CLI de Vercel, para cargar las variables y para el script alternativo: `pnpm add --global vercel` y `vercel login`.

Los secretos viven en la bóveda `CriterIA` de 1Password y los comandos los leen con `op read -n "op://CriterIA/<elemento>/<campo>"` (`-n` evita el salto de línea final). Cada rol de Neon tiene su elemento:

| Elemento | Rol | Campos |
| --- | --- | --- |
| `neon-migrator-role` | `migrator_role` | `password`, `url` |
| `neon-api-role` | `api_role` | `password`, `url` |
| `neon-eval-writer` | `eval_writer` | `password`, `url` |
| `neon-web-role` | `web_role` | `password`, `url`, `url-pooler` |

`url` es la URL directa y `url-pooler` la del pooler (sección 2). Groq, Sentry, la OAuth App, `BETTER_AUTH_SECRET` y `CREDENTIALS_KEYS` son elementos propios de la misma bóveda.

## 1. GCP

Una sola vez. Al terminar, `gcloud config set project <proyecto>` y `export GCP_PROJECT_ID=<proyecto>`.

1. **Proyecto y facturación.** Crear el proyecto (`gcloud projects create <proyecto>`) y ligarlo a la cuenta de facturación en la consola (Billing > Account management).
2. **Alerta de presupuesto de 1 USD.** Billing > Budgets & alerts > Create budget: alcance el proyecto, monto 1 USD y avisos al 50 %, 90 % y 100 % por correo.
3. **APIs.**

   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
   ```

4. **Artifact Registry**, con tags inmutables y la política de limpieza del repositorio:

   ```bash
   gcloud artifacts repositories create criteria --repository-format=docker \
     --location=us-central1 --immutable-tags
   gcloud artifacts repositories set-cleanup-policies criteria --location=us-central1 \
     --policy=services/api/deploy/artifact-cleanup.json --no-dry-run
   ```

5. **Cuenta de servicio** de la API, sin roles de proyecto:

   ```bash
   gcloud iam service-accounts create criteria-api --display-name="CriterIA API"
   ```

6. **Secretos.** Cada uno se crea desde 1Password y solo la cuenta de la API puede leerlo:

   | Secreto | Variable de la API | Origen en 1Password |
   | --- | --- | --- |
   | `criteria-database-url` | `DATABASE_URL` | `op://CriterIA/neon-api-role/url` (sección 2) |
   | `criteria-credentials-keys` | `CREDENTIALS_KEYS` | Llave nueva, nunca la local |
   | `criteria-groq-api-key` | `GROQ_API_KEY` | Clave de Groq del modo gratuito |
   | `criteria-sentry-dsn` | `SENTRY_DSN` | DSN del proyecto de Sentry de la API |

   La llave de las claves de usuario se genera una vez, directo a 1Password:

   ```bash
   key="1:$(openssl rand -base64 32)"
   op item create --vault=CriterIA --category=password --title="CriterIA CREDENTIALS_KEYS" "password=$key"
   unset key
   ```

   Después, por cada secreto, con su ruta de la tabla (para la base, `op://CriterIA/neon-api-role/url`):

   ```bash
   op read -n "op://CriterIA/<elemento>/<campo>" | gcloud secrets create <secreto> \
     --replication-policy=user-managed --locations=us-central1 --data-file=-
   gcloud secrets add-iam-policy-binding <secreto> \
     --member="serviceAccount:criteria-api@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
     --role=roles/secretmanager.secretAccessor
   ```

   Para cambiar uno: `op read -n … | gcloud secrets versions add <secreto> --data-file=-`, desplegar de nuevo la API (los secretos se leen al arrancar cada instancia) y destruir la versión anterior con `gcloud secrets versions destroy <versión> --secret=<secreto>`.

**Control:** `gcloud secrets list` muestra los 4 secretos, y `gcloud secrets get-iam-policy <secreto>` muestra solo a `criteria-api` como `secretAccessor`.

## 2. Neon

El proyecto ya existe en `aws-us-east-2` (Ohio) con Postgres 16. La base se llama `criteria` y su dueño es `criteria_owner`; no se usan `neondb` ni `neondb_owner`.

1. **Roles.** En el editor SQL de Neon, sobre la base `criteria` y como `criteria_owner`, pegar y ejecutar `services/api/db/roles.sql` completo. El script es idempotente.
   - **Qué crea:**
     - los roles `migrator_role`, `api_role`, `eval_writer` y `web_role`, con `LOGIN` y sin contraseña;
     - los esquemas `app` y `graph`, de `migrator_role`, y `auth`, de `web_role`.
   - **Permisos del dueño:** le da a `criteria_owner` `SET` e `INHERIT` sobre `migrator_role` y `web_role`. En Postgres 16, quien crea un rol sin ser superusuario solo recibe `ADMIN` y no podría entregarle esquemas. Se probó como dueño no superusuario en un Postgres 16 desechable.
   - **`search_path` de la web:** fija `search_path=auth` en `web_role`, porque el pooler de Neon trabaja por transacción y no conserva opciones por conexión.
2. **Contraseñas.** Generar en 1Password, en el campo `password` de cada elemento, una contraseña de 40 o más letras y números, sin símbolos, para que la URL no necesite escapes. Neon no acepta `\password` de `psql`, así que se asignan con `ALTER ROLE … PASSWORD` desde `psql` en la Mac:

   ```bash
   printf 'URL directa de criteria_owner: '; read -rs owner_url; echo
   for role in migrator_role api_role eval_writer web_role; do
     printf 'Contraseña de %s: ' "$role"; read -rs pw; echo
     printf "ALTER ROLE %s PASSWORD :'pw';\n" "$role" | psql "$owner_url" -X -q -v ON_ERROR_STOP=1 -v pw="$pw"
   done
   unset owner_url pw
   ```

   - **URL del dueño:** la de `criteria_owner` sobre `criteria`, del botón Connect del panel de Neon, con el host directo.
   - **Cada contraseña:** se pega desde el campo `password` de su elemento cuando el bloque la pide.
   - **Por qué así:** `read -s` no muestra lo que se pega, y `psql` recibe la sentencia por la entrada estándar y cita la contraseña con `:'pw'`. Ni las contraseñas ni la URL quedan en el historial del shell, en el de `psql` (que solo guarda sesiones interactivas) ni en el editor SQL de Neon.
   - **Probado:** el bloque funciona en zsh y en bash. Se probó en un Postgres 16 desechable, con `criteria_owner` como dueño no superusuario.
3. **URLs.** Se arman a mano y se guardan en 1Password, siempre con la base `criteria` y `?sslmode=require`:

   ```text
   postgresql://<rol>:<password>@<host>/criteria?sslmode=require
   ```

   - **Host directo:** el del panel, por ejemplo `ep-<id>.c-8.us-east-2.aws.neon.tech`.
   - **Host con pooler:** se inserta `-pooler` después del primer segmento: `ep-<id>-pooler.c-8.us-east-2.aws.neon.tech`.

   | URL | Rol | Host | En 1Password | Destino |
   | --- | --- | --- | --- | --- |
   | API | `api_role` | directo | `op://CriterIA/neon-api-role/url` | Secret Manager `criteria-database-url` |
   | Migraciones de la API | `migrator_role` | directo | `op://CriterIA/neon-migrator-role/url` | GitHub, `MIGRATION_DATABASE_URL` |
   | Migraciones de Better Auth | `web_role` | directo | `op://CriterIA/neon-web-role/url` | GitHub, `AUTH_MIGRATION_DATABASE_URL` |
   | Web | `web_role` | pooler | `op://CriterIA/neon-web-role/url-pooler` | Vercel, `AUTH_DATABASE_URL` |
   | Evaluación | `eval_writer` | directo | `op://CriterIA/neon-eval-writer/url` | Solo la Mac, al publicar |

**Control:**
- En el editor SQL, `SELECT rolname, rolconfig FROM pg_roles WHERE rolname LIKE '%_role' OR rolname = 'eval_writer';` lista los cuatro roles y `web_role` con `{search_path=auth}`.
- La URL de la web entra por el pooler y cae en `auth` sin opciones de conexión. Este comando debe imprimir `web_role|auth`:

  ```bash
  psql "$(op read -n 'op://CriterIA/neon-web-role/url-pooler')" -XAtc "SELECT current_user, current_setting('search_path')"
  ```

Conexiones: con 0.25 CU, Neon admite 112 (105 para la aplicación). Cada instancia de la API abre hasta 30 (`DATABASE_POOL_SIZE` 10, más 10 de desborde y 10 para los checkpoints), así que 2 instancias usan como mucho 60. La web pasa por el pooler.

## 3. GitHub

1. **OAuth App de producción.** Settings > Developer settings > OAuth Apps, una app distinta de la de desarrollo:
   - Homepage URL: `https://criter-ia.vercel.app`.
   - Authorization callback URL: `https://criter-ia.vercel.app/api/auth/callback/github`.
   - Solo pide `user:email`; los tokens de GitHub no se guardan.
   - El Client ID y un Client secret nuevo van a 1Password.
2. **Environment `production`.** Settings > Environments > New environment:
   - **Required reviewers:** tu usuario. En un repositorio privado hace falta un plan de pago para esta regla.
   - **Deployment branches and tags:** solo `main`.
   - **Secretos:**

     ```bash
     op read -n "op://CriterIA/neon-migrator-role/url" | gh secret set MIGRATION_DATABASE_URL --env production
     op read -n "op://CriterIA/neon-web-role/url" | gh secret set AUTH_MIGRATION_DATABASE_URL --env production
     ```

**Control:** `gh secret list --env production` lista los dos nombres y nada más.

## 4. Sentry

Dos proyectos: uno de Python (FastAPI) para la API y uno de Next.js para la web.

- **DSN de la API:** va a Secret Manager (`criteria-sentry-dsn`).
- **DSN de la web:** va a Vercel como `NEXT_PUBLIC_SENTRY_DSN`. Es público por diseño y queda incrustado en el build. La CSP agrega sola el origen de ingesta del DSN (`https://o<n>.ingest.us.sentry.io`) a `connect-src`.
- **Sin PII:** ambos SDK la tienen desactivada y filtran `Authorization` y la clave propia.
- **Source maps:** todavía no se suben.

## 5. Vercel

1. **Proyecto.** En el panel de Vercel, Add New > Project, importar el repositorio de GitHub con «Import single project», no con «Services».
   - **Root Directory:** `apps/web`. Vercel lee de ahí `apps/web/vercel.json`, que fija el framework, la instalación con lockfile congelado y la región `cle1`.
   - **Despliegues automáticos:** `vercel.json` desactiva los de `main` (`git.deploymentEnabled.main: false`), así que un push no despliega la web.
   - **Node.js Version:** 26.x en Settings > Build and Deployment. `engines.node` de `package.json` también la fija.
   - **pnpm:** la variable `ENABLE_EXPERIMENTAL_COREPACK=1` hace que Vercel use el pnpm de `packageManager` (12.16.1). Sin ella, elegiría pnpm 9 o 10 por la versión del lockfile. El log del build debe mostrar `pnpm 12.16.1`.
   - **El dominio:** `criter-ia.vercel.app`. Es el `WEB_URL` de `production.env` y el origen de la OAuth App.
   - **CLI:** `vercel link` en la raíz del repositorio liga este mismo proyecto y escribe `.vercel/`, que está ignorado. Lo necesitan `vercel env add` y el script alternativo.
2. **Variables de producción.** Cada secreto entra desde 1Password, marcado como sensitive:

   ```bash
   op read -n "op://CriterIA/<elemento>/<campo>" | vercel env add <VARIABLE> production --sensitive
   ```

   Por ejemplo, `op read -n "op://CriterIA/neon-web-role/url-pooler" | vercel env add AUTH_DATABASE_URL production --sensitive`. Las públicas se agregan igual con `printf '%s' '<valor>' | vercel env add <VARIABLE> production`. También se pueden cargar en Settings > Environment Variables, pegando desde 1Password y marcando Sensitive.

| Variable | Valor | Nota |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_ENV` | `production` | Activa `upgrade-insecure-requests` en la CSP y las cookies `Secure` |
| `NEXT_PUBLIC_API_URL` | URL de Cloud Run (`https://criteria-api-<número>.us-central1.run.app`) | Se incrusta en el build y entra en `connect-src`; se conoce tras el primer despliegue de la API |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN del proyecto web | Público |
| `NEXT_PUBLIC_OFFICE_VIEW` | `false` | La vista oficina llega en F9 |
| `NEXT_PUBLIC_CONTACT_URL` | Vacía o un `mailto:` | Vacía enlaza `https://github.com/GDavila97` en "Privacidad y datos" |
| `BETTER_AUTH_SECRET` | Nuevo, de 48 bytes (`openssl rand -base64 48` hacia 1Password) | Sensitive. Firma sesiones y cifra la llave privada del JWKS: cambiarlo invalida las sesiones y obliga a borrar `auth.jwks` |
| `BETTER_AUTH_URL` | `https://criter-ia.vercel.app` | Origen público, sin barra final |
| `AUTH_DATABASE_URL` | `op://CriterIA/neon-web-role/url-pooler` | Sensitive. URL de `web_role` con pooler |
| `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` | Vacías | Usan `BETTER_AUTH_URL`, igual que `AUTH_ISSUER` y `AUTH_AUDIENCE` de la API |
| `EMAIL_PROVIDER` | `none` | Sin dominio no hay envío ([ADR 0020](adr/0020-github-first-sign-in-without-email.md)) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | De la OAuth App de producción | El secreto, sensitive |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | pnpm de `packageManager` |

`GOOGLE_*`, `SMTP_URL`, `RESEND_API_KEY`, `EMAIL_FROM` y `GITHUB_STUB_URL` no se definen en producción.

**Control:** `vercel env ls production`, o Settings > Environment Variables, lista solo los nombres de arriba.

## 6. Cada despliegue

Tú haces `git push`; todo lo demás usa el SHA completo de ese commit (`git rev-parse HEAD`).

1. **CI verde.** `gh run list --workflow ci.yml --commit <sha>` muestra `success`. Los scripts lo comprueban otra vez.
2. **Migraciones.**

   ```bash
   gh workflow run migrate.yml -f sha=<sha>
   gh run watch
   ```

   El job `verify` comprueba que el SHA esté en `main` y que el CI haya pasado. Después, el job `migrate` espera tu aprobación en la pestaña Actions, porque el environment `production` lo exige. Corre primero `pnpm auth:migrate` como `web_role` y luego `alembic upgrade head` como `migrator_role`. Las migraciones de Better Auth solo comparan y crean tablas: corren con un secreto aleatorio y no crean llaves del JWKS. Se comprobó que dejan `auth.jwks` vacía.
   **Control:** el log termina con `alembic current` en la última revisión.
3. **API.**

   ```bash
   DRY_RUN=1 services/api/scripts/deploy.sh <sha>   # revisa y muestra los comandos
   services/api/scripts/deploy.sh <sha>
   ```

   `GCP_PROJECT_ID` tiene que estar exportado.
   - **Comprobaciones:** árbol limpio, SHA completo en `origin/main` y CI verde.
   - **Imagen:** construye desde `git archive` del SHA (nada sin commit entra en la imagen), la etiqueta `api:<sha>`, la sube y despliega con los recursos de la tabla de decisiones. Si la imagen ya existe, la reutiliza.
   - **Variables:** salen de `services/api/deploy/production.env` tal como está en ese SHA.
   - **Secretos:** se montan con `--set-secrets`.
   - **Al final:** consulta `/health` (no `/healthz`, que Cloud Run reserva; ver «Capa gratuita y costos»).

   **Control:** `gcloud run services describe criteria-api --region=us-central1 --format='value(metadata.labels.commit-sha)'` devuelve el SHA.
4. **Web.**
   1. Confirma con el control del paso 3 que Cloud Run ya corre ese SHA.
   2. En el panel de Vercel, en el proyecto, Deployments > Create Deployment: pega el SHA completo y crea el despliegue.
   3. Vercel clona ese commit de GitHub y compila con las variables de producción.

   **Control:** el despliegue aparece como Production con ese commit, y el log del build muestra `pnpm 12.16.1`.

   **Alternativa con la CLI** (requiere `vercel link`):

   ```bash
   apps/web/scripts/deploy.sh <sha>
   ```

   - **Comprobaciones:** las mismas que la API, y además que Cloud Run ya corra ese SHA.
   - **Qué sube:** un `git worktree` desacoplado del SHA, así que no viajan archivos sin commit ni `.env`.
   - **Despliegue:** `vercel deploy --prod`, y Vercel compila con las variables de producción.
5. **Prueba de humo.**

   ```bash
   scripts/smoke-prod.sh https://criteria-api-<número>.us-central1.run.app https://criter-ia.vercel.app
   ```

   Solo lee, sin iniciar sesión ni crear corridas, y termina con `All checks passed`. Comprueba:
   - **Salud y rutas privadas:** `/health`, y 401 sin token y con un token falso.
   - **Tablero:** `/evaluation` devuelve los lotes y el acuerdo del juez.
   - **CORS:** permite solo el origen de la web y nunca credenciales.
   - **Cabeceras de seguridad** de la API y de la web, incluida la CSP con nonce y con la API en `connect-src`.
   - **JWKS** de la web y redirección de `http` a `https`.
   - **Navegador:** Chromium a 1280 px y a 390 px carga `/`, `/privacidad` y el tablero sin violaciones de CSP.

   Requiere `pnpm install` en `apps/web` y Chromium de Playwright.

### Primer despliegue

El primer despliegue sigue el mismo orden, con dos pasos extra:
1. `WEB_URL` ya está en `production.env` con `https://criter-ia.vercel.app`; si el dominio cambia, se cambia ahí con commit y push antes de desplegar la API.
2. Después de desplegar la API, ya conoces su URL: la pones en `NEXT_PUBLIC_API_URL` de Vercel antes de desplegar la web.

## 7. Publicar la evaluación

Una vez, y de nuevo solo si cambian los resultados. Desde la Mac, con `eval_writer`, que solo puede insertar. La publicación es idempotente:

```bash
cd services/api
export EVAL_DATABASE_URL="$(op read -n 'op://CriterIA/neon-eval-writer/url')"
for file in eval/results/v1/*.json; do
  case "$(basename "$file")" in human.json|estabilidad.json|reporte.json) continue ;; esac
  uv run criteria eval publish --file "$file"
done
uv run criteria eval publish --human
unset EVAL_DATABASE_URL
```

La variable exportada gana sobre el `EVAL_DATABASE_URL` local de `.env`. **Control:** una segunda pasada no agrega resultados («0 resultados nuevos», «Puntajes humanos nuevos: 0»), y `/evaluation` de la API devuelve los tres lotes.

## 8. Tope del modo gratuito

`production.env` fija 0.10 USD y 11 corridas diarias. 30 días suman el límite mensual de 3 USD de Groq, y cada corrida gratuita reserva unos 0.0087 USD con el perfil calibrado en F5. El día se cuenta en UTC: en Ciudad de México se reinicia a las 18:00. Los meses de 31 días pueden tocar el límite de Groq el último día. El límite de gasto de la consola de Groq es el corte duro.

El día de la entrevista, subirlo sin desplegar código, por ejemplo a 0.50 USD (57 corridas):

```bash
gcloud run services update criteria-api --region=us-central1 \
  --update-env-vars=GLOBAL_DAILY_BUDGET_USD=0.50,GLOBAL_DAILY_RUNS=57
```

Esto crea una revisión con la misma imagen. Lo que se gaste de más sale del mismo límite mensual de Groq. Al terminar, regresarlo:

```bash
gcloud run services update criteria-api --region=us-central1 \
  --update-env-vars=GLOBAL_DAILY_BUDGET_USD=0.10,GLOBAL_DAILY_RUNS=11
```

O volver a desplegar el SHA actual con `deploy.sh`, que reaplica `production.env`.

## 9. La IP real en Vercel

Better Auth lee solo `x-forwarded-for`, y la ruta `/api/auth` conserva su primera dirección: Better Auth ignora una cabecera con varias direcciones, y todos quedarían en un mismo contador. Para comprobar que un cliente no puede falsificarla:

1. Anota tu IP pública en cada red, por ejemplo con `https://ifconfig.me`: la Mac en el wifi y el iPhone con datos móviles.
2. Desde cada red, manda un inicio de sesión fallido con cabeceras falsas:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://criter-ia.vercel.app/api/auth/sign-in/email" \
     -H "Origin: https://criter-ia.vercel.app" -H 'Content-Type: application/json' \
     -H 'X-Forwarded-For: 203.0.113.7' -H 'X-Real-IP: 203.0.113.7' \
     -d '{"email":"nadie@example.com","password":"no-es-una-clave"}'
   ```

   En el iPhone, abre `https://criter-ia.vercel.app` con datos móviles e intenta entrar con una cuenta inexistente.
3. En el editor SQL de Neon:

   ```sql
   SELECT key, "lastRequest" FROM auth."rateLimit" ORDER BY "lastRequest" DESC LIMIT 5;
   ```

Debe haber una clave por red (`<tu IP>|/sign-in/email`) con tus IPs reales, y ninguna con `203.0.113.7`.

## 10. Checklist de cierre

- [ ] Prueba de humo: `All checks passed`.
- [ ] Teléfono real (iPhone, 390 px): inicio, corrida completa, tablero y ajustes, en claro y oscuro.
- [ ] Cabeceras y CORS: cubiertos por la prueba de humo. Revisa también https://securityheaders.com sobre la web.
- [ ] IP real desde dos redes (sección 9).
- [ ] Límite de uso con dos cuentas: con la cuenta A, la sexta corrida en una hora responde «Alcanzaste el límite de corridas por hora»; la cuenta B sigue pudiendo.
- [ ] Flujo de GitHub: entrar, ver el correo verificado en "Cuenta" y salir.
- [ ] Flujo de correo y contraseña: registro con el aviso de recuperación, entrada y borrado de la cuenta.
- [ ] Una corrida real con Groq (modo gratuito) de principio a fin, con el costo mostrado.
- [ ] PageSpeed Insights (https://pagespeed.web.dev) de la web en móvil y escritorio; anota los cuatro puntajes.
- [ ] Alerta de presupuesto activa en Billing > Budgets, y límite de gasto de 3 USD en la consola de Groq.
- [ ] Sentry recibe un evento de prueba de la API y de la web.

## Variables y secretos

### API (Cloud Run)

| Variable | Dónde vive | Nota |
| --- | --- | --- |
| `DATABASE_URL` | Secret Manager | `api_role`, URL directa de Neon |
| `CREDENTIALS_KEYS` | Secret Manager | Llave nueva de producción, 32 bytes aleatorios por versión. Perderla hace ilegibles las claves guardadas |
| `GROQ_API_KEY` | Secret Manager | Única clave de proveedor en producción |
| `SENTRY_DSN` | Secret Manager | Proyecto de la API |
| `WEB_ORIGIN`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` | `production.env` (`WEB_URL`) | Origen exacto de la web; el script los deriva |
| `APP_ENV`, `LOG_LEVEL`, `SENTRY_TRACES_SAMPLE_RATE`, `SERVER_KEY_PROVIDERS`, `AUTH_REQUIRE_VERIFIED_EMAIL`, `CREDENTIALS_ACTIVE_KEY` | `production.env` | `production`, `info`, `0.0`, `groq`, `false` y `1`. Sin `OLLAMA_BASE_URL` |
| `USER_RUNS_PER_HOUR`, `USER_RUNS_PER_DAY`, `GLOBAL_DAILY_RUNS`, `GLOBAL_DAILY_BUDGET_USD` | `production.env` | 5, 20, 11 y 0.10 (sección 8) |
| `RUN_TTL_MINUTES`, `SSE_HEARTBEAT_SECONDS`, `MAX_REQUEST_BYTES`, `PROVIDER_TIMEOUTS`, `DATABASE_POOL_SIZE` | — | Valores por defecto |
| `MODEL_BACKEND` | — | Siempre `real`; `fake` solo arranca con `APP_ENV=test` |

### GitHub (environment `production`)

| Secreto | Nota |
| --- | --- |
| `MIGRATION_DATABASE_URL` | `migrator_role`, URL directa |
| `AUTH_MIGRATION_DATABASE_URL` | `web_role`, URL directa |

### Solo en la Mac

| Variable | Nota |
| --- | --- |
| `GCP_PROJECT_ID` | Para los dos scripts de despliegue |
| `EVAL_DATABASE_URL` | `eval_writer`, URL directa; solo al publicar la evaluación |

## Rotación de la llave de las claves

1. Agregar la versión nueva a `CREDENTIALS_KEYS` (`1:…,2:…`) como nueva versión del secreto, sin cambiar `CREDENTIALS_ACTIVE_KEY`, y desplegar.
2. Cambiar `CREDENTIALS_ACTIVE_KEY=2` en `production.env` y desplegar: las claves nuevas se cifran con la 2 y las viejas se siguen leyendo con la 1.
3. Retirar la versión 1 solo cuando ninguna fila la use (`SELECT count(*) FROM app.provider_credential WHERE key_version = 1`). Las claves que no se pueden descifrar se tratan como inexistentes y el usuario debe guardarlas de nuevo.

## Migraciones

El orden importa: primero las de Better Auth, que crean `auth."user"`, y después las de la API, porque la migración 0004 agrega llaves foráneas hacia esa tabla. Las tablas de `auth` quedan a nombre de `web_role`, y los privilegios por defecto de `roles.sql` dan a `migrator_role` solo `REFERENCES` sobre ellas, nunca lectura.

Qué hace cada migración de la API:
1. Crea las tablas de `app`.
2. Aplica las migraciones del checkpointer de LangGraph en `graph`.
3. Agrega `app.run.settled`, que evita ajustar dos veces el cupo de una corrida.
4. Liga cada `user_id` de `app` a `auth."user"` con borrado en cascada, y guarda los planes por agente y la decisión de historial de cada corrida.
5. Agrega los detalles de la evaluación y los permisos de inserción de `eval_writer`.

La API no ejecuta DDL: si los checkpoints no están en la última versión, se niega a arrancar. Al actualizar `langgraph-checkpoint-postgres` hay que agregar una migración de Alembic que vuelva a correr sus migraciones. Las migraciones solo avanzan: nunca se hace `downgrade` en producción, y cada una debe ser compatible con la versión anterior de la API.

## Reversión

- **API.** `services/api/scripts/deploy.sh <sha anterior>`: reutiliza la imagen si sigue en Artifact Registry, que conserva las 3 más recientes, y si no la reconstruye. Para un corte inmediato: `gcloud run services update-traffic criteria-api --region=us-central1 --to-revisions=<revisión>=100`.
- **Web.** `vercel rollback` o, en el panel, Instant Rollback al despliegue anterior. Después, Create Deployment (o `apps/web/scripts/deploy.sh`) con el SHA bueno, para que la web vuelva a coincidir con la API.
- **Base.** No se revierte. Un cambio de esquema roto se corrige con una migración nueva.
