# 0020. GitHub como acceso principal mientras no se envían correos

**Estado:** aceptada (7 nov 2026). Ajusta la [0008](0008-better-auth-and-api-jwt.md).

**Contexto:** la 0008 pedía verificación de correo y recuperación de contraseña con Resend. Sin un dominio propio, un servicio de envío solo entrega correos a la dirección del dueño de la cuenta, así que por ahora no se puede escribir a cualquier persona que se registre. La API exige un correo verificado para crear corridas.

**Decisión:**

- "Continuar con GitHub" es la opción principal. GitHub ya verificó el correo y se encarga de la recuperación de la cuenta; Better Auth pide el scope mínimo para leer el correo verificado y las cuentas de GitHub cuentan como verificadas.
- Solo se usa GitHub para iniciar sesión: sus tokens de acceso no se guardan.
- Correo y contraseña sigue disponible, sin verificación ni recuperación, con un aviso en el registro: "Por ahora no hay recuperación de contraseña. Guárdala en un lugar seguro."
- El envío de correos queda detrás de `EMAIL_PROVIDER` (`none`, `smtp` o `resend`). Con `none` no hay verificación ni pantalla de recuperación; con `smtp` o `resend` ambas se activan sin cambiar código.
- La API deja de exigir el correo verificado con `AUTH_REQUIRE_VERIFIED_EMAIL=false` mientras `EMAIL_PROVIDER=none`. Por defecto la variable vale `true`.
- Nunca se vincula automáticamente una cuenta de GitHub con una cuenta existente cuyo correo no esté verificado. La persona ve "Ya existe una cuenta con este correo; entra con tu contraseña", sin más detalles.
- Google queda preparado para activarse por configuración, sin botón por ahora.

**Alternativas:** comprar un dominio ahora (costo y verificación de DNS antes de la entrega); solo GitHub (deja fuera a quien no tiene cuenta); enlace mágico por correo (depende del mismo envío que falta).

**Consecuencias:** una cuenta de correo y contraseña no prueba que la persona controle ese correo, así que el límite por usuario se puede eludir con correos inventados; lo acotan el límite de registros por IP y el tope global diario. Quien olvide su contraseña tiene que crear otra cuenta. Al tener dominio, basta con `EMAIL_PROVIDER=resend` y `AUTH_REQUIRE_VERIFIED_EMAIL=true`. La no vinculación automática evita que alguien que registró primero el correo de otra persona se quede con su cuenta de GitHub.
