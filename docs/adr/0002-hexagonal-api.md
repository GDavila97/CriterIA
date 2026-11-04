# 0002. API con arquitectura hexagonal

**Estado:** aceptada.

**Contexto:** los proveedores de LLM, la persistencia y el transporte (HTTP, CLI) deben poder cambiarse y probarse sin red. La evaluación por lotes reutiliza el mismo núcleo que la API.

**Decisión:** puertos y adaptadores. `domain` (esquemas, rúbrica, eventos, sin dependencias externas), `application` (grafo y casos de uso), `ports` (interfaces), `adapters` (proveedores, Postgres, FastAPI, CLI). Las dependencias apuntan al dominio; la composición ocurre en un único módulo de arranque.

**Alternativas:** capas simples de FastAPI (rápido, pero acopla el grafo al transporte); Clean Architecture con casos de uso por clase (más ceremonia de la necesaria).

**Consecuencias:** la CLI de evaluación y la API comparten el núcleo sin duplicar código. Más archivos al inicio, compensados por pruebas unitarias sin red.
