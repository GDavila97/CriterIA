# Auditoría de dependencias: overrides y excepciones

Las auditorías del CI (`pip-audit --strict` y `pnpm audit --audit-level=moderate`) no se relajan. Cuando una vulnerabilidad llega por una dependencia transitiva sin versión corregida aguas arriba, se fuerza la versión corregida con un override y se registra aquí. Cada override se retira en cuanto la dependencia directa adopte la versión corregida.

## Overrides activos

Definidos en `apps/web/pnpm-workspace.yaml`.

| Paquete     | Rango vulnerable  | Forzado a | Aviso                                                                               | Llega por                                      | Verificación                                                                                                                            |
| ----------- | ----------------- | --------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `glob`      | `>=9.0.0 <14.0.2` | `^14.0.3` | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) (moderada) | `@sentry/nextjs` → `@sentry/bundler-plugins`   | El consumidor solo llama a `glob(patrones, opciones)`, que no cambia en la versión 14                                                   |
| `minimatch` | `>=7.0.0 <11.0.1` | `^11.0.4` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (moderada) | `glob`; `@typescript-eslint/typescript-estree` | Los consumidores solo llaman a `minimatch(ruta, patrón, opciones)`; no usan `makeRe()` ni `Minimatch#regexp`, que la versión 11 elimina |

Tras aplicarlos pasan lint, typecheck, Vitest, build y Playwright.

## Excepciones aceptadas

Ninguna.
