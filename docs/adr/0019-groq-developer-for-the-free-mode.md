# 0019. Modo gratuito sobre el plan Developer de Groq

**Estado:** aceptada (5 nov 2026). Ajusta la [0016](0016-claves-por-usuario.md).

**Contexto:** la 0016 ofrecía el modo gratuito sobre el plan gratuito de Groq. En F2b, una corrida completa usó entre 28,000 y 38,000 tokens y el pico medido en un minuto llegó a 21,000, así que una sola corrida puede rebasar los tokens por minuto del plan gratuito.

**Decisión:**

- El modo gratuito para el usuario sigue siendo Groq con la clave del servidor, pero sobre el plan Developer, que es de pago.
- El gasto se protege con un tope global diario en corridas (`GLOBAL_DAILY_RUNS`) y en dólares (`GLOBAL_DAILY_BUDGET_USD`) para todo lo que use claves del servidor. Al crear la corrida se reserva de forma atómica el costo estimado de la parte que paga el servidor, y al terminar se ajusta con el real. Al agotarse el cupo, `POST /runs` responde `cupo_gratuito_agotado`.
- El límite por usuario (corridas por hora y por día) aplica a todos, con o sin clave propia.

**Alternativas:** seguir en el plan gratuito (las corridas fallarían por límite de tokens por minuto); usar otro proveedor gratuito (descartados en la 0006 por el uso de los datos).

**Consecuencias:** el modo gratuito genera un costo acotado por el tope diario. Los precios de Groq del catálogo son provisionales hasta verificarlos en la consola de Groq en F5.
