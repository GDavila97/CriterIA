from dataclasses import dataclass


@dataclass(frozen=True)
class Database:
    name: str
    admin: str
    migrator: str
    api: str
    eval_writer: str
