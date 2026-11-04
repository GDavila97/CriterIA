# 0006. Proveedores de modelos y respaldo

**Estado:** aceptada.

**Contexto:** presupuesto de unos 10 dólares en OpenAI y 10 en Anthropic; la app debe seguir funcionando sin créditos y solo con el modelo local; el juez no debe calificar a su propio proveedor sin advertirlo.

**Decisión:** registro de proveedores por configuración: `openai`, `anthropic`, `groq`, `ollama`, `openai_compatible`. Producción: generación con el modelo mini vigente de OpenAI y juez con Claude Haiku. Respaldo: tope diario o error de cuota → Groq (plan gratuito, no entrena con los datos) → modo consulta. Clave propia del usuario solo en memoria y por cabecera. URL base personalizada con protección SSRF. `PROVIDER=ollama` hace funcionar todo en local sin claves.

**Alternativas:** Gemini gratuito como respaldo (descartado: usa los datos para mejorar sus productos y puede haber revisión humana); un solo proveedor (sin comparación ni respaldo).

**Consecuencias:** el tablero puede comparar cuatro modelos con el mismo juez. El puntaje de Haiku se reporta con la advertencia de autopreferencia.
