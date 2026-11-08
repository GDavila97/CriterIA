# 0021. Salida JSON nativa para gpt-oss-20b en Groq

**Estado:** aceptada (8 nov 2026). Extiende la [0017](0017-native-output-for-local-models.md).

**Contexto:** en el primer lote de la evaluación v1, `openai/gpt-oss-20b` en Groq con salida por herramienta no completó ninguna corrida: 0 de 7 casos, 0 de 8 llamadas válidas a la primera. Al reintentar, el modelo devolvía la salida correcta, pero llamaba a la herramienta `functions.final_result` en lugar de `final_result`, un rasgo de su formato de herramientas. Pydantic AI la trata como una herramienta desconocida, sin reintento, y la corrida terminaba en `salida_invalida`. Otras veces Groq rechazaba la llamada mal formada con un 400 (`proveedor_no_disponible`). Es el modelo del modo gratuito en producción, así que el problema no era solo de la evaluación.

**Decisión:** `openai/gpt-oss-20b` declara `output_mode = "native"` en `config/models.toml`: la salida se pide como JSON restringido al esquema (`NativeOutput`), que Groq admite para este modelo. El esquema, los validadores de coherencia, el reintento único, los códigos de error y los prompts no cambian. Cada modelo corre con el `output_mode` de su entrada del catálogo, y los lotes, el reporte y el tablero lo muestran junto al nombre del modelo.

**Alternativas:** quitar el prefijo `functions.` del nombre de la herramienta con un envoltorio del modelo (depende de un detalle no documentado del modelo); dejarlo así y reportarlo como fallo del modelo (mediría el formato, no los artefactos, y dejaría el modo gratuito sin funcionar).

**Consecuencias:** en la prueba con tres casos, las tres salidas fueron válidas a la primera con una sola petición cada una. El lote de Groq con salida por herramienta se descartó y se repitió completo con salida nativa; el hallazgo queda en `docs/evaluation.md`. Como en la 0017, solo se comparan resultados del mismo modelo con el mismo modo de salida.
