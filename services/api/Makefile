.PHONY: install lint format format-check typecheck test audit check run

AUDIT_REQUIREMENTS := .audit-requirements.txt

install:
	uv sync --frozen

lint:
	uv run ruff check .

format:
	uv run ruff format .

format-check:
	uv run ruff format --check .

typecheck:
	uv run mypy

test:
	uv run pytest

audit:
	uv export --frozen --format requirements-txt --no-emit-project --quiet --output-file $(AUDIT_REQUIREMENTS)
	uv run pip-audit --strict --disable-pip --require-hashes -r $(AUDIT_REQUIREMENTS)

check: lint format-check typecheck test audit

run:
	uv run criteria-api
