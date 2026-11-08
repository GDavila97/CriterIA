# 0017. Salida JSON nativa para los modelos locales

**Estado:** aceptada (5 nov 2026). Ajusta la [0004](0004-pydantic-ai-agents.md); extendida por la [0021](0021-native-output-for-gpt-oss-on-groq.md) (gpt-oss-20b en Groq).

**Contexto:** la 0004 define cada agente con un `output_type` tipado, y Pydantic AI lo pide por defecto como una llamada a una herramienta de salida. En la selección del modelo local (F2b), con salida por herramienta, `qwen3:8b` completó 1 de 3 corridas y `llama3.1:8b` ninguna. Casi todos los fallos fueron de formato: respuestas en texto en lugar de llamar a la herramienta, campos obligatorios ausentes (`gherkin`) y tipos incorrectos. Ollama acepta además `response_format` con `json_schema` y restringe la generación al esquema.

**Decisión:**

- Cada modelo del catálogo (`config/models.toml`) declara `output_mode`: `tool` (por defecto) o `native`.
- Con `native`, el agente pide la salida con `NativeOutput` de Pydantic AI, que Ollama recibe como JSON restringido al esquema. Los modelos de Ollama usan `native`; OpenAI, Anthropic, Groq y los endpoints compatibles siguen con `tool`.
- El esquema, los validadores de coherencia, el reintento único y los códigos de error no cambian, y los prompts tampoco.

**Alternativas:** mantener la salida por herramienta y mejorar los prompts (no resuelve las respuestas en texto y mezcla esta decisión con la mejora v2); salida en texto con el esquema en el prompt (`PromptedOutput`), sin restricción en la generación.

**Consecuencias:** con salida nativa, los dos modelos locales pasaron al 96 % de salidas válidas a la primera (`llama3.1:8b` completó 3 de 3 corridas y `qwen3:8b` 2 de 3). El modo de salida pasa a ser parte de la configuración de cada modelo y queda registrado en `docs/evaluation.md`. Cambiar el modo de un modelo cambia sus resultados, así que solo se comparan corridas con el mismo modo.
