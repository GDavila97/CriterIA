# 0008. Autenticación con Better Auth y JWT para la API

**Estado:** aceptada.

**Contexto:** se necesitan cuentas para límites por usuario (en la entrevista todos comparten la IP de Cimat) e historial. Los datos de usuarios deben quedar en la base propia.

**Decisión:** Better Auth en Next.js con correo y contraseña, verificación de correo y recuperación (envío con Resend). Sesión en cookie httpOnly, Secure, SameSite=Lax. El plugin JWT emite tokens de 5 minutos que la web guarda solo en memoria y envía a la API; la API valida firma, emisor, audiencia y expiración con JWKS en caché. Correr una corrida exige correo verificado.

**Alternativas:** sin cuentas con límite por IP (compartida en la entrevista); Clerk (datos con un tercero); Auth0 (excesivo); magic link como único método (depende de que el correo llegue al instante).

**Consecuencias:** el streaming va directo a Cloud Run sin pasar por funciones de Vercel. Hay que operar el dominio de envío de correos.
