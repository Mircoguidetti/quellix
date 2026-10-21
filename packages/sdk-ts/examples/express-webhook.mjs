// Usage: QUELLIX_WEBHOOK_SECRET=... node examples/express-webhook.mjs   (needs `npm i express`)
import express from "express";
import { SIGNATURE_HEADER, WebhookSignatureError, constructEvent } from "@quellix/sdk";

const app = express();

// The signature covers the exact bytes Quellix sent: use the raw body, not parsed JSON.
app.post("/quellix/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await constructEvent(req.body, req.get(SIGNATURE_HEADER), process.env.QUELLIX_WEBHOOK_SECRET);
    console.log(event.data.id, event.data.decision?.decision);
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return res.sendStatus(400);
    throw error;
  }
});

app.listen(3000);
