# 0014. CSP estricta con nonce en `proxy.ts`

**Estado:** aceptada (4 nov 2026).

**Contexto:** el plan pide una CSP estricta sin `unsafe-eval` y sin `unsafe-inline` en scripts. El App Router de Next.js inserta scripts en línea (hidratación y payload RSC), así que una CSP estática en `next.config` solo funciona con `'unsafe-inline'` en `script-src`, lo que anula la protección frente a XSS. Next.js aplica un nonce automáticamente a sus scripts y estilos si la petición trae una cabecera CSP con `'nonce-…'`, pero solo en páginas renderizadas por petición.

**Decisión:**

- `apps/web/proxy.ts` genera un nonce por petición y envía la CSP en la petición (para que Next.js la lea) y en la respuesta. La política se construye con una función pura (`src/shared/lib/security/csp.ts`) con pruebas unitarias.
- Directivas: `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`; `style-src 'self' 'nonce-…'`; `img-src 'self' blob: data:`; `font-src 'self'`; `connect-src 'self'` más el origen de la API y el de ingesta de Sentry, tomados de las variables de entorno validadas; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests` solo con `NEXT_PUBLIC_APP_ENV=production`.
- `'unsafe-eval'` se agrega solo con `next dev`, porque React lo usa en desarrollo para reconstruir pilas de error del servidor. En producción no hay `'unsafe-inline'` ni `'unsafe-eval'` en ninguna directiva.
- En producción los estilos no necesitan `'unsafe-inline'`: Next.js y `next/font` funcionan con el nonce. La UI no usa el atributo `style` en línea; los estilos van en CSS Modules.
- Excepción documentada, solo con `next dev`: las herramientas de desarrollo de Next.js inyectan elementos `<style>` sin nonce. Como los navegadores ignoran `'unsafe-inline'` cuando hay un nonce en la misma directiva, en desarrollo `style-src` queda en `'self' 'unsafe-inline'` sin nonce. Esto no llega a ningún build de producción, y las pruebas e2e corren contra `next start`.
- Zod 4 comprueba si puede usar `new Function()` para compilar validadores; en el navegador eso dispara una violación de `script-src`. Se activa `z.config({ jitless: true })` en el esquema de entorno.
- El layout raíz llama a `connection()` para que todas las páginas se rendericen por petición.
- Las cabeceras fijas (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security`) se declaran en `next.config.ts`.
- Una prueba e2e falla si el navegador reporta una violación de CSP (evento `securitypolicyviolation` o mensaje en consola) y otra comprueba las cabeceras.

**Alternativas:** CSP estática en `next.config` con `'unsafe-inline'` en scripts (más simple y con páginas estáticas, pero débil frente a XSS); hashes de scripts (los scripts en línea cambian por página y por petición).

**Consecuencias:** no hay páginas estáticas ni ISR; cada visita se renderiza en el servidor, algo que la app necesitará de todos modos por la sesión. Cualquier script de terceros debe cargarse con el nonce o desde un origen ya permitido, y agregar un origen a `connect-src` exige cambiar la función y sus pruebas.
