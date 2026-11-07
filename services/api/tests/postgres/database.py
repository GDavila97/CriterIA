from dataclasses import dataclass

import psycopg

# The columns of Better Auth's user table that the API's foreign keys depend on.
AUTH_USER_TABLE = """
CREATE TABLE auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false
)
"""


@dataclass(frozen=True)
class Database:
    name: str
    admin: str
    migrator: str
    api: str
    eval_writer: str

    def ensure_user(self, user_id: str) -> None:
        with psycopg.connect(self.admin, autocommit=True) as conn:
            conn.execute(
                'INSERT INTO auth."user" (id, name, email) VALUES (%s, %s, %s) '
                "ON CONFLICT (id) DO NOTHING",
                (user_id, user_id, f"{user_id}@example.test"),
            )
