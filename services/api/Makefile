.PHONY: install lint format format-check typecheck test test-integration audit contract check run db-up db-setup migrate

AUDIT_REQUIREMENTS := .audit-requirements.txt
# Local docker compose cluster only.
LOCAL_ADMIN_URL := postgresql://criteria:criteria@127.0.0.1:5432
LOCAL_ROLE_PASSWORD := criteria-local

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
	uv run pytest -m "not integration and not ollama"

test-integration:
	TEST_DATABASE_ADMIN_URL=$(LOCAL_ADMIN_URL)/criteria uv run pytest

audit:
	uv export --frozen --format requirements-txt --no-emit-project --quiet --output-file $(AUDIT_REQUIREMENTS)
	uv run pip-audit --strict --disable-pip --require-hashes -r $(AUDIT_REQUIREMENTS)

contract:
	uv run criteria-contract

check: lint format-check typecheck test audit
	uv run criteria-contract --check

run:
	uv run criteria-api

db-up:
	docker compose up -d --wait

db-setup:
	psql "$(LOCAL_ADMIN_URL)/criteria" -v ON_ERROR_STOP=1 -q -f db/roles.sql
	psql "$(LOCAL_ADMIN_URL)/criteria" -v ON_ERROR_STOP=1 -q \
		-c "ALTER ROLE migrator_role PASSWORD '$(LOCAL_ROLE_PASSWORD)'" \
		-c "ALTER ROLE api_role PASSWORD '$(LOCAL_ROLE_PASSWORD)'" \
		-c "ALTER ROLE eval_writer PASSWORD '$(LOCAL_ROLE_PASSWORD)'"

migrate:
	uv run --env-file .env alembic upgrade head
