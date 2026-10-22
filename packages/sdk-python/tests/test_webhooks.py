from __future__ import annotations

import hashlib
import hmac

import pytest

from ormes import WebhookSignatureError, construct_event, verify_signature

SECRET = "whsec_test"
BODY = (
    b'{"type":"video.decided","created_at":"2026-01-01T00:00:00Z","data":{"id":"vid_1",'
    b'"status":"decided","rubric_id":"r","rubric_version":1,"created_at":"2026-01-01T00:00:00Z"}}'
)
NOW = 1_800_000_000.0


def sign(data: bytes) -> str:
    return hmac.new(SECRET.encode(), data, hashlib.sha256).hexdigest()


def stamped(t: int = int(NOW)) -> str:
    return f"t={t},v1={sign(f'{t}.'.encode() + BODY)}"


def test_bare_hex_signature() -> None:
    assert verify_signature(BODY, sign(BODY), SECRET)
    assert verify_signature(BODY.decode(), sign(BODY), SECRET)


def test_timestamped_signature_within_tolerance() -> None:
    assert verify_signature(BODY, stamped(), SECRET, now=NOW)
    assert verify_signature(BODY, stamped(), SECRET, now=NOW + 299)


@pytest.mark.parametrize(
    "header",
    ["", "zz", "t=abc,v1=" + "0" * 64, "v1=", "t=1800000000", "0" * 64],
)
def test_rejects_bad_headers(header: str) -> None:
    assert not verify_signature(BODY, header, SECRET, now=NOW)


def test_rejects_stale_tampered_and_wrong_secret() -> None:
    assert not verify_signature(BODY, stamped(), SECRET, now=NOW + 301)
    assert not verify_signature(BODY + b" ", stamped(), SECRET, now=NOW)
    assert not verify_signature(BODY, stamped(), "other", now=NOW)
    assert not verify_signature(BODY, None, SECRET)
    # A malformed timestamp must not fall back to an unchecked signature.
    assert not verify_signature(BODY, f"t=abc,v1={sign(BODY)}", SECRET)


def test_construct_event() -> None:
    event = construct_event(BODY, sign(BODY), SECRET)
    assert event.data.id == "vid_1"
    with pytest.raises(WebhookSignatureError):
        construct_event(BODY, "00", SECRET)


def test_signature_header_names() -> None:
    from ormes import LEGACY_SIGNATURE_HEADER, SIGNATURE_HEADER, signature_from_headers

    assert SIGNATURE_HEADER == "Ormes-Signature" and LEGACY_SIGNATURE_HEADER == "Quellix-Signature"
    assert signature_from_headers({"ormes-signature": "a"}) == "a"
    assert signature_from_headers({"Quellix-Signature": "b"}) == "b"
    assert signature_from_headers({"Ormes-Signature": "a", "Quellix-Signature": "b"}) == "a"
    assert signature_from_headers({"X-Other": "c"}) is None
