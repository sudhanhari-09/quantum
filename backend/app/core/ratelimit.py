"""Simple in-process rate limiter (B10/B35).

Interface is isolated so a production Redis limiter can replace the storage
without touching route handlers. Limits are resolved LAZILY from settings
per request so environment overrides always take effect.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from functools import wraps
from typing import Callable

from app.core.exceptions import RateLimitedError

# scope -> settings attribute providing the per-minute limit
SCOPE_LIMIT_ATTRS = {
    "auth": "rate_limit_auth_per_min",
    "user_search": "rate_limit_search_per_min",
    "attack_launch": "rate_limit_attack_per_min",
}

# scope+key -> timestamps of allowed calls
_HITS: dict[tuple[str, str], deque] = defaultdict(deque)


def _resolve_limit(scope: str) -> int:
    from app.core.config import get_settings

    attr = SCOPE_LIMIT_ATTRS.get(scope, "rate_limit_default_per_min")
    return int(getattr(get_settings(), attr))


class RateLimiterBackend:
    """Swap point for a distributed backend."""

    def hit(self, key: tuple[str, str], limit: int, window_seconds: int = 60) -> bool:
        """Record a call; return False when over the limit."""
        now = time.monotonic()
        dq = _HITS[key]
        while dq and now - dq[0] > window_seconds:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True

    def reset(self) -> None:
        _HITS.clear()


backend = RateLimiterBackend()


def rate_limit(scope: str) -> Callable:
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            request = kwargs.get("request") or next(
                (a for a in args if hasattr(a, "client")), None
            )
            if request is None:
                return func(*args, **kwargs)
            user = getattr(request.state, "user", None)
            identity = f"user:{user.id}" if user is not None else f"ip:{request.client.host}"
            if not backend.hit((scope, identity), _resolve_limit(scope)):
                raise RateLimitedError()
            return func(*args, **kwargs)

        return wrapper

    return decorator
