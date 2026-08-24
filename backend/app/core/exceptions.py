"""Typed application errors rendered through the global error envelope.

Envelope shape (binding contract, Section 19):
    {"code": "PASCAL_SNAKE", "message": "...", "details": {...}}
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base class for every user-safe API error."""

    status_code = 500
    code = "INTERNAL_ERROR"
    message = "An unexpected internal error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        self.message = message or self.message
        self.details = details or {}
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code
        super().__init__(self.message)


class ValidationError(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"
    message = "Request validation failed."


class UnauthorizedError(AppError):
    status_code = 401
    code = "UNAUTHORIZED"
    message = "Authentication required."


class ForbiddenError(AppError):
    status_code = 403
    code = "ROLE_FORBIDDEN"
    message = "You are not allowed to perform this action."


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"
    message = "Resource not found."


class ConflictError(AppError):
    status_code = 409
    code = "CONFLICT"
    message = "Conflict."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    message = "Too many requests. Please slow down."
