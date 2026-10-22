from __future__ import annotations

from typing import Any

import httpx


class OrmesError(Exception):
    """Base class for every error raised by this SDK."""


class APIError(OrmesError):
    """The API answered with an error status."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        request_id: str | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.body = body


class AuthenticationError(APIError):
    """401 or 403: the API key is missing, invalid or not allowed."""


class NotFoundError(APIError):
    """404."""


class ValidationError(APIError):
    """400 or 422. `fields` carries field-level details when the API provides them."""

    def __init__(self, *args: Any, fields: Any = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.fields = fields


class RateLimitError(APIError):
    """429. `retry_after` is the `Retry-After` header in seconds, if present."""

    def __init__(self, *args: Any, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.retry_after = retry_after


class ConnectionError(OrmesError):  # noqa: A001 - mirrors the TypeScript SDK
    """Network failure or timeout: no HTTP response was received."""


class TimeoutError(OrmesError):  # noqa: A001
    """`wait_for_decision` ran out of time."""


class WebhookSignatureError(OrmesError):
    """The webhook signature is missing, malformed, stale or wrong."""


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    from email.utils import parsedate_to_datetime

    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    import time

    return max(0.0, when.timestamp() - time.time())


def error_from_response(response: httpx.Response) -> APIError:
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    err = body.get("error") if isinstance(body, dict) else None
    err = err if isinstance(err, dict) else {}
    status = response.status_code
    code = str(err.get("code") or f"http_{status}")
    message = str(err.get("message") or f"Request failed with status {status}")
    common: dict[str, Any] = {"request_id": response.headers.get("x-request-id"), "body": body}
    if status in (401, 403):
        return AuthenticationError(status, code, message, **common)
    if status == 404:
        return NotFoundError(status, code, message, **common)
    if status == 429:
        retry_after = parse_retry_after(response.headers.get("retry-after"))
        return RateLimitError(status, code, message, retry_after=retry_after, **common)
    if status in (400, 422):
        fields = err.get("fields", err.get("details"))
        return ValidationError(status, code, message, fields=fields, **common)
    return APIError(status, code, message, **common)
