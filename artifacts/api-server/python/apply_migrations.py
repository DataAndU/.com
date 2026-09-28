"""Apply the additive SQL migrations in ../migrations to DATABASE_URL.

Safe to re-run: every statement is `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
or `ANALYZE`. Statements run in autocommit mode (CONCURRENTLY requires it).
Refuses to run any file containing destructive statements.

Usage (App Platform: api component -> Console tab):
    python python/apply_migrations.py
"""
import os
import re
import sys
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
DESTRUCTIVE = re.compile(r"\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE)\b", re.IGNORECASE)


def statements(sql):
    code = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [part.strip() for part in code.split(";") if part.strip()]


def database_url():
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is not set")
    return url.replace("postgresql+psycopg://", "postgresql://", 1).replace(
        "postgres://", "postgresql://", 1)


def main():
    files = sorted(MIGRATIONS.glob("*.sql"))
    plan = [(path, statements(path.read_text())) for path in files]
    for path, stmts in plan:
        for statement in stmts:
            if DESTRUCTIVE.search(statement):
                raise SystemExit(f"Refusing destructive statement in {path.name}")
    with psycopg.connect(database_url(), autocommit=True) as connection:
        invalid = connection.execute(
            "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
            "WHERE NOT i.indisvalid AND c.relname LIKE 'ix_%'").fetchall()
        if invalid:
            names = ", ".join(row[0] for row in invalid)
            raise SystemExit(f"Invalid (interrupted) indexes found: {names}. "
                             "Drop them with DROP INDEX CONCURRENTLY, then re-run.")
        for path, stmts in plan:
            for statement in stmts:
                connection.execute(statement)
            print(f"applied {path.name} ({len(stmts)} statements)")
    print("migrations complete")


if __name__ == "__main__":
    sys.exit(main())
