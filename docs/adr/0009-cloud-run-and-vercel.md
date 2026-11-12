# 0009. Despliegue: Cloud Run para la API y Vercel para la web

**Estado:** aceptada; concretada por la [0022](0022-production-deployment.md).

**Contexto:** se busca evidencia de nube a costo cero y que la app siga viva después de la entrevista.

**Decisión:** API en GCP Cloud Run (us-central1, capa Always Free), imagen en Artifact Registry, secretos en Secret Manager, máximo 2 instancias y alerta de presupuesto en 1 dólar. Web en Vercel. Todos los despliegues son manuales (nada desde GitHub Actions), con la secuencia push → CI verde → migraciones → API → web, mismo SHA.

**Alternativas:** AWS (el plan gratuito cierra la cuenta a los 6 meses); Azure (sin ventaja para este caso); todo en Vercel (sin evidencia de nube y con límites para Python y streaming).

**Consecuencias:** arranque en frío de algunos segundos tras inactividad. GCP requiere tarjeta registrada; el tope de instancias y la alerta limitan el riesgo.
