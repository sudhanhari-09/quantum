"""FastAPI application factory, middleware, and router registration (B1)."""

from __future__ import annotations

import uuid
import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger, request_id_ctx

logger = get_logger(__name__)


def _envelope(code: str, message: str, details: dict | None = None) -> dict:
    return {"code": code, "message": message, "details": details or {}}


def create_app() -> FastAPI:
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "Quantum Secure Communication platform backend. All quantum "
            "operations are classical simulations; QBER thresholds are "
            "simulation thresholds."
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        response.headers["X-Request-ID"] = request_id
        # Security headers (S23 clickjacking / nosniff / referrer).
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Content-Security-Policy", "frame-ancestors 'none'; default-src 'none'"
        )
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # Log HTTP request in the new format: LEVEL  METHOD  PATH  STATUS
        log_msg = f"{request.method}  {request.url.path}  {response.status_code}"
        logger.info(log_msg)
        return response

    # ---- error envelope handlers -------------------------------------------
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        logger.warning("%s  %s  %s  %s", request.method, request.url.path, exc.code, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = []
        for err in exc.errors():
            details.append(
                {
                    "loc": [str(loc) for loc in err.get("loc", [])],
                    "msg": err.get("msg"),
                    "type": err.get("type"),
                }
            )
        return JSONResponse(
            status_code=422,
            content=_envelope("VALIDATION_ERROR", "Request validation failed.", {"errors": details}),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        code_map = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 401: "UNAUTHORIZED"}
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                code_map.get(exc.status_code, f"HTTP_{exc.status_code}"),
                str(exc.detail),
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error path=%s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content=_envelope("INTERNAL_ERROR", "An unexpected internal error occurred."),
        )

    # ---- routers ------------------------------------------------------------
    from app.api.routers.health import router as health_router
    from app.api.routers.auth import router as auth_router
    from app.api.routers.users import router as users_router
    from app.api.routers.admin import router as admin_router
    from app.api.routers.messages import router as messages_router
    from app.api.routers.communications import router as communications_router
    from app.api.routers.attacks import (
        router as attacks_router,
        comm_router as attacks_comm_router,
        eve_router as eve_router,
    )
    from app.api.routers.reports import router as reports_router, alias_router as reports_alias_router
    from app.api.routers.protocols import router as protocols_router
    from app.api.routers.dashboard import router as dashboard_router

    api_prefix = "/api/v1"
    app.include_router(health_router, prefix=api_prefix)
    app.include_router(auth_router, prefix=api_prefix)
    app.include_router(users_router, prefix=api_prefix)
    app.include_router(admin_router, prefix=api_prefix)
    app.include_router(messages_router, prefix=api_prefix)
    # NOTE: /communications/active must be matched before /communications/{comm_id}.
    app.include_router(attacks_comm_router, prefix=api_prefix)
    app.include_router(communications_router, prefix=api_prefix)
    app.include_router(attacks_router, prefix=api_prefix)
    app.include_router(eve_router, prefix=api_prefix)
    app.include_router(reports_router, prefix=api_prefix)
    app.include_router(reports_alias_router, prefix=api_prefix)
    app.include_router(protocols_router, prefix=api_prefix)
    app.include_router(dashboard_router, prefix=api_prefix)

    # ---- websockets (B33) -----------------------------------------------------
    from app.ws.routes import router as ws_router

    app.include_router(ws_router)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        from app.services.realtime_service import realtime

        realtime.bind_loop(asyncio.get_running_loop())
        logger.info("startup complete version=%s env=%s", __version__, settings.qsc_env)
        yield
        logger.info("shutdown complete")
        # Cancel lingering realtime tasks (populated in later phases).
        for task in asyncio.all_tasks():
            if task is not asyncio.current_task() and "realtime" in (task.get_name() or ""):
                task.cancel()

    app.router.lifespan_context = lifespan

    return app


app = create_app()
