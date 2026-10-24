"""SQLAlchemy engine + session + init helpers."""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings

_IS_SQLITE = settings.DATABASE_URL.startswith("sqlite")

# SQLite needs check_same_thread=False for FastAPI request threads.
# Postgres needs an explicit pre_ping so the pooled connection recovers after
# Render recycles an idle connection (serverless DB / free tier restarts).
if _IS_SQLITE:
    connect_args = {"check_same_thread": False}
    engine_kwargs = {"connect_args": connect_args}
else:
    connect_args = {}
    engine_kwargs = {"connect_args": connect_args, "pool_pre_ping": True, "pool_recycle": 280}

engine = create_engine(settings.DATABASE_URL, future=True, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create all tables. Safe to call on every startup."""
    # Import models so they register with Base.metadata
    from . import case  # noqa: F401
    from sqlalchemy import inspect, text

    Base.metadata.create_all(bind=engine)

    # Safe migration: ensure optional new columns exist if table was previously created
    with engine.connect() as conn:
        # NOTE: SQLAlchemy 2.x auto-begins; do NOT call conn.begin() — it raises
        # PendingRollbackError if a transaction is already active on SQLite.
        inspector = inspect(engine)
        if "cases" in inspector.get_table_names():
            existing_cols = {col["name"] for col in inspector.get_columns("cases")}
            if "sharpness_status" not in existing_cols:
                conn.execute(text("ALTER TABLE cases ADD COLUMN sharpness_status VARCHAR"))
                conn.commit()  # DDL must be committed explicitly


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
