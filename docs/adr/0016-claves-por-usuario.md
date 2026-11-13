# 0016. Claves de API por usuario y Groq gratuito por defecto

**Estado:** aceptada. Ajusta el ADR 0006; ajustada por la [0019](0019-groq-developer-for-the-free-mode.md) (modo gratuito sobre el plan Developer de Groq).

**Contexto:** la herramienta la usarán otras personas (estudiantes y docentes). Las claves del autor no deben pagar el uso de terceros, y quien use un modelo de pago debe hacerlo con su propia cuenta.

**Decisión:**

- En producción, la única opción con clave del servidor es Groq en su plan gratuito, con límite por usuario y un tope global diario que protege la cuota. Es la opción por defecto: cualquiera puede probar la herramienta sin configurar nada.
- Para OpenAI, Anthropic, Groq con cuenta propia y endpoints compatibles con OpenAI, cada usuario registra su clave en "Modelos y claves". Las claves del autor solo existen en su `.env` local para la evaluación por lotes; `SERVER_KEY_PROVIDERS` define qué proveedores pueden usar clave del servidor (en producción, solo `groq`).
- Las claves se guardan cifradas en `app.provider_credential` con AES-256-GCM. La llave maestra (`CREDENTIALS_MASTER_KEY`) vive en Secret Manager y nunca en el código ni en la base. El dato asociado es `user_id` más el proveedor, para que un texto cifrado no sirva en otra fila, y `key_version` permite rotar la llave.
- Las claves son de solo escritura: la API solo devuelve los últimos 4 caracteres y el texto en claro solo existe en memoria durante una corrida. Se validan al guardarse con la llamada más barata del proveedor, se pueden borrar en cualquier momento y se borran en cascada con la cuenta.
- El usuario elige un nivel por proveedor (Económico, Equilibrado, Máximo) y ve el modelo real y el costo estimado por corrida antes de ejecutar.
- En corridas de usuario, el juez usa un proveedor distinto al de generación si el usuario tiene otro configurado; si no, usa el mismo y la corrida lo indica. La evaluación oficial del tablero conserva su juez fijo.
- No hay cambio de proveedor automático. Si una clave falla por saldo, invalidez o límite, la corrida termina con un código seguro y la interfaz ofrece "Usar el gratuito", porque cambiar de proveedor envía los datos a otro tercero.
- Ollama queda como configuración del servidor (`OLLAMA_BASE_URL`) para uso local. La app desplegada no puede alcanzar redes privadas de los usuarios; la conexión de Ollama por usuario se diseñará después de la entrega.

**Alternativas:**

- Claves del autor con tope global: el autor paga el uso de todos.
- Clave solo en memoria por sesión: más segura, pero obliga a pegarla en cada visita.
- Clave en el navegador (localStorage): expuesta a XSS y prohibida por los criterios de seguridad del proyecto.
- Cifrado con Cloud KMS por usuario: más robusto, pero agrega costo y complejidad que este proyecto no necesita.

**Consecuencias:**

- La app desplegada no genera costo de API al autor.
- Se agregan una tabla, un secreto y una pantalla de ajustes.
- El rendimiento del modo gratuito depende de los límites de Groq.
- La transparencia sobre qué proveedor recibe los datos y con qué clave pasa a ser parte de la interfaz.
