// Usage: ORMES_WEBHOOK_SECRET=... node examples/express-webhook.mjs   (needs `npm i express`)
import express from "express";
import { WebhookSignatureError, constructEvent, signatureFromHeaders } from "@ormes/sdk";

const app = express();

// The signature covers the exact bytes Ormes sent: use the raw body, not parsed JSON.
app.post("/ormes/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await constructEvent(req.body, signatureFromHeaders(req.headers), process.env.ORMES_WEBHOOK_SECRET);
    console.log(event.data.id, event.data.decision?.decision);
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return res.sendStatus(400);
    throw error;
  }
});

app.listen(3000);
