"""Explicit development schema creation. Never imported by application startup."""
import os

import billing_models  # noqa: F401
import models
from deps import engine

if os.getenv("NODE_ENV") not in {"development", "test"}:
    raise SystemExit("Development migration refused outside development/test")
if engine is None:
    raise SystemExit("DATABASE_URL is not configured")
models.Base.metadata.create_all(engine)
print("Development schema is current")