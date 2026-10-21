"""Receive `video.decided` webhooks.

Usage (needs `pip install fastapi uvicorn`):
    QUELLIX_WEBHOOK_SECRET=... uvicorn examples.fastapi_webhook:app
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request

from quellix import SIGNATURE_HEADER, WebhookSignatureError, construct_event

app = FastAPI()


@app.post("/quellix/webhook", status_code=204)
async def quellix_webhook(request: Request) -> None:
    # The signature covers the exact bytes Quellix sent: read the raw body, do not parse it first.
    raw = await request.body()
    try:
        header = request.headers.get(SIGNATURE_HEADER)
        event = construct_event(raw, header, os.environ["QUELLIX_WEBHOOK_SECRET"])
    except WebhookSignatureError:
        raise HTTPException(status_code=400, detail="invalid signature") from None
    decision = event.data.decision
    print(event.data.id, decision.decision.value if decision else None)
