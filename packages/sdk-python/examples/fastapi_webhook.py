"""Receive `video.decided` webhooks.

Usage (needs `pip install fastapi uvicorn`):
    ORMES_WEBHOOK_SECRET=... uvicorn examples.fastapi_webhook:app
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request

from ormes import WebhookSignatureError, construct_event, signature_from_headers

app = FastAPI()


@app.post("/ormes/webhook", status_code=204)
async def ormes_webhook(request: Request) -> None:
    # The signature covers the exact bytes Ormes sent: read the raw body, do not parse it first.
    raw = await request.body()
    try:
        header = signature_from_headers(request.headers)
        event = construct_event(raw, header, os.environ["ORMES_WEBHOOK_SECRET"])
    except WebhookSignatureError:
        raise HTTPException(status_code=400, detail="invalid signature") from None
    decision = event.data.decision
    print(event.data.id, decision.decision.value if decision else None)
