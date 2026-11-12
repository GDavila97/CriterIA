# 0022. Despliegue de producción: imagen local, pooler para la web y Cloud Run medido

**Estado:** aceptada (12 nov 2026). Concreta la [0009](0009-cloud-run-and-vercel.md).

**Contexto:** la 0009 fija Cloud Run, Vercel y Neon con despliegues manuales. Para prepararlos faltaba decidir:
- dónde se construye la imagen;
- qué URL de Neon usa cada parte;
- de qué cabecera sale la IP del cliente;
- cómo se dimensiona el servicio.

Hay que hacerlo sin salir de la capa gratuita, con una Mac de Apple Silicon que construye para `amd64`.

**Decisión:**

- **Imagen.** Se construye en la Mac con `docker buildx --platform linux/amd64` desde `git archive` del SHA, después de comprobar que el árbol está limpio, que el SHA está en `origin/main` y que el CI pasó. Se sube a Artifact Registry con el tag `api:<sha>` inmutable, y una política de limpieza conserva las 3 más recientes. No se usa Cloud Build.
- **Servicio.** Cloud Run en `us-central1`:
  - 1 vCPU con CPU solo durante las peticiones, 512 MiB y primera generación;
  - concurrencia 10, de 0 a 2 instancias, tiempo límite de 900 s;
  - cuenta de servicio propia, sin roles de proyecto y con acceso solo a sus 4 secretos;
  - variables no secretas desde `services/api/deploy/production.env`, leído del mismo SHA.
- **Base.**
  - La API usa la URL directa de Neon, porque su lock es de sesión.
  - La web usa la URL con pooler. `search_path=auth` vive en `web_role` (`ALTER ROLE` en `roles.sql`), no en la conexión.
  - Las migraciones de Better Auth y de Alembic usan la URL directa y corren en un workflow manual con environment protegido.
- **IP del cliente.** Better Auth lee solo `x-forwarded-for`, y la ruta `/api/auth` deja solo su primera dirección.
- **Web.** Se importa en Vercel como proyecto único con Root Directory `apps/web` y se despliega desde el panel con Create Deployment y el SHA, después de comprobar que Cloud Run ya corre ese SHA. `apps/web/scripts/deploy.sh` queda como alternativa con la CLI: hace las mismas comprobaciones y corre `vercel deploy --prod` desde un `git worktree` del SHA. Las funciones corren en `cle1`, junto a Neon en Ohio.

**Alternativas:**
- **Cloud Build:** compila de forma nativa en `amd64` y tiene 2,500 minutos gratis al mes, pero agrega una API, permisos y un bucket multirregional fuera de la capa gratuita de Cloud Storage. La compilación emulada local tardó 79 s.
- **URL directa también para la web:** una base de 0.25 CU admite 105 conexiones, que varias funciones con su propio pool podrían agotar.
- **`x-real-ip`:** Vercel no documenta que la sobrescriba.
- **Concurrencia de 80 (la de Cloud Run por defecto):** con 20 streams se agotó el pool de conexiones.

**Consecuencias:**
- **Medición:** con la imagen y modelos simulados, la API ocupó 209 MiB en reposo y 235 MiB con 20 corridas simultáneas.
- **Límite por instancia:** más de unos 10 streams por instancia agotan el pool de SQLAlchemy, que es de 20 conexiones. La concurrencia de Cloud Run lo evita repartiendo entre 2 instancias, y lo que exceda espera en la cola de Cloud Run.
- **`roles.sql`:** ahora da al dueño de la base `SET` e `INHERIT` sobre los roles que crea, porque en Postgres 16 un dueño no superusuario, como `criteria_owner` en Neon, no puede entregarles esquemas sin eso.
- **Desplegar requiere que el SHA esté en `main`:** un cambio de `production.env`, como el dominio de la web, se publica con commit y push antes de desplegar.
