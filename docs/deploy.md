# Despliegue

> Esqueleto. Se completa en F6 con los valores reales; ningún paso de esta guía corre desde GitHub Actions.

Todos los despliegues son manuales ([ADR 0009](adr/0009-cloud-run-and-vercel.md)). Secuencia: push → CI verde → migraciones → API → web, siempre con el mismo SHA.

## Requisitos previos

- Proyecto de GCP con facturación, alerta de presupuesto de 1 dólar y región `us-central1`.
- Artifact Registry para la imagen de la API.
- Secret Manager con los secretos de la API, cargados desde 1Password.
- Proyecto de Vercel con `deploymentEnabled.main: false`.
- Base de Neon de producción con los roles `web_role`, `api_role`, `migrator_role` y `eval_writer`.

## Variables y secretos

Pendiente. Partirá de `services/api/.env.example` y `apps/web/.env.example`, indicando para cada variable dónde vive (Secret Manager o Vercel).

## Migraciones

Pendiente: workflow manual con environment protegido que corre las migraciones de Better Auth (esquema `auth`) y de Alembic (esquema `app`).

## API en Cloud Run

Pendiente: build y push de la imagen del SHA verificado, despliegue con máximo 2 instancias, cuenta de servicio, secretos y tiempo de espera para SSE.

## Web en Vercel

Pendiente: despliegue manual del mismo SHA y variables de producción.

## Verificación posterior

Pendiente. Checklist de cierre: teléfono real (iPhone, 390 px), cabeceras de seguridad, CORS, límite de uso con dos cuentas, flujo completo de registro y verificación, PageSpeed y alerta de presupuesto activa.

## Reversión

Pendiente.
