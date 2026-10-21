from __future__ import annotations

import hashlib
import hmac
import re
import time

from .errors import WebhookSignatureError
from .types import VideoDecidedEvent

SIGNATURE_HEADER = "Quellix-Signature"
_HEX = re.compile(r"^[0-9a-fA-F]+$")


def verify_signature(
    payload: bytes | str,
    header: str | None,
    secret: str,
    *,
    tolerance: float = 300,
    now: float | None = None,
) -> bool:
    """Verify the `Quellix-Signature` header against the raw request body.

    Accepts `t=<unix>,v1=<hex>` (HMAC-SHA256 over ``"<t>.<body>"``, rejected when older than
    `tolerance` seconds) and the bare hex HMAC of the body the API sends today (no timestamp to
    check). Comparison is constant-time. Pass the exact bytes received, never re-serialized JSON.
    """
    if not header:
        return False
    body = payload.encode() if isinstance(payload, str) else payload
    timestamp, signatures = _parse_header(header)
    if not signatures:
        return False
    signed = body
    if timestamp is not None:
        current = time.time() if now is None else now
        if abs(current - timestamp) > tolerance:
            return False
        signed = f"{timestamp}.".encode() + body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    # Compare against every candidate so the time taken does not reveal which one matched.
    return any([hmac.compare_digest(expected, sig.lower()) for sig in signatures])


def construct_event(
    payload: bytes | str,
    header: str | None,
    secret: str,
    *,
    tolerance: float = 300,
    now: float | None = None,
) -> VideoDecidedEvent:
    """Verify the signature and return the parsed event, or raise `WebhookSignatureError`."""
    if not verify_signature(payload, header, secret, tolerance=tolerance, now=now):
        raise WebhookSignatureError("Invalid webhook signature.")
    return VideoDecidedEvent.model_validate_json(payload)


def _parse_header(header: str) -> tuple[int | None, list[str]]:
    value = header.strip()
    if "=" not in value:
        return None, [value] if _HEX.match(value) else []
    timestamp: int | None = None
    signatures: list[str] = []
    saw_timestamp = False
    for part in value.split(","):
        key, _, val = part.strip().partition("=")
        if key == "t":
            saw_timestamp = True
            timestamp = int(val) if val.isdigit() else None
        elif key == "v1" and _HEX.match(val):
            signatures.append(val)
    # A malformed timestamp must not downgrade to an unchecked signature.
    if saw_timestamp and timestamp is None:
        return None, []
    return timestamp, signatures
