"""Structured logging setup with request-id context support."""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdLogFormatter(logging.Formatter):
    """Formatter that injects the current request id into every record
    and outputs: LEVEL  METHOD  PATH  STATUS [ERROR_CODE]"""

    def format(self, record: logging.LogRecord) -> str:
        record.request_id = request_id_ctx.get()
        message = record.getMessage()
        # Construct: LEVEL-8s followed by the message
        return f"{record.levelname:<8s} {message}"


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    formatter = RequestIdLogFormatter("%(message)s")
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    try:
        root.setLevel(getattr(logging, level.upper(), logging.INFO))
    except Exception:
        root.setLevel(logging.INFO)

    for noisy in ("uvicorn.access", "sqlalchemy.engine.Engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
