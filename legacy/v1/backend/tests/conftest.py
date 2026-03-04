from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kwargs):
    # SQLite test DBs don't support PostgreSQL JSONB; use JSON affinity.
    return "JSON"
