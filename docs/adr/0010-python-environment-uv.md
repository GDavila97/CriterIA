# 0010. Entorno Python con uv

**Estado:** aceptada.

**Contexto:** el entorno debe ser idéntico en la máquina de desarrollo, el CI y la imagen Docker.

**Decisión:** uv con `.venv` local (ignorado en Git), versión de Python fijada en `.python-version` y `uv.lock` versionado. El CI y el Dockerfile instalan con `uv sync --frozen`.

**Alternativas:** pip con `requirements.txt` (sin lockfile real); Poetry (más lento y otra herramienta que aprender).

**Consecuencias:** instalaciones reproducibles y rápidas. Dependabot debe vigilar `uv.lock`.
