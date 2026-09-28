"""Apply the additive SQL migrations in ../migrations to DATABASE_URL.

Safe to re-run: every statement is `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
or `ANALYZE`. Statements run in autocommit mode (CONCURRENTLY requires it).
Refuses destructive statements (DROP/TRUNCATE/DELETE/UPDATE/RENAME and any
ALTER other than ADD COLUMN IF NOT EXISTS or DROP NOT NULL).

Usage (App Platform: api component -> Console tab):
    python python/apply_migrations.py
"""
import os
import re
import sys
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
DESTRUCTIVE = re.compile(r"\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|ALTER)\b", re.IGNORECASE)
# The only ALTER forms allowed: purely additive / constraint-relaxing.
ALLOWED_ALTER = [
    re.compile(r"^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ [A-Z0-9_() ]+$", re.IGNORECASE),
    re.compile(r"^ALTER TABLE \w+ ALTER COLUMN \w+ DROP NOT NULL$", re.IGNORECASE),
]


def destructive(statement):
    flat = " ".join(statement.split())
    if any(pattern.match(flat) for pattern in ALLOWED_ALTER):
        return False
    # A foreign-key rule inside CREATE TABLE is not a data deletion.
    if flat.upper().startswith("CREATE TABLE"):
        flat = re.sub(r"ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)", "", flat, flags=re.IGNORECASE)
    return bool(DESTRUCTIVE.search(flat))


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
            if destructive(statement):
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
