# Seguridad

## Reportar una vulnerabilidad

Reporta cualquier vulnerabilidad de forma privada desde la pestaña **Security** de este repositorio, con **Report a vulnerability**. No abras un issue público ni compartas los detalles antes de que se corrija.

Incluye, si puedes:

- qué parte afecta (web, API, despliegue o dependencias) y la URL o el archivo;
- los pasos para reproducirla y el impacto que esperas;
- la versión o el commit en que la observaste.

Recibirás un acuse en un plazo de 7 días.

## Alcance

- La app desplegada en [criter-ia.vercel.app](https://criter-ia.vercel.app) y su API.
- El código de este repositorio.

Al investigar, no accedas a datos de otras personas, no hagas pruebas de carga ni de denegación de servicio y no uses escáneres automáticos contra producción: la API tiene un tope diario de uso compartido por todos. Las claves de prueba y los requerimientos que envíes deben ser ficticios.

## Medidas actuales

El resumen está en la sección [Seguridad del README](README.md#seguridad), y el detalle en [architecture.md](docs/architecture.md#seguridad-transversal) y [api.md](docs/api.md).
