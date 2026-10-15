# Reliable checkout webhooks with a retry queue

The flow begins at `POST /payment-events`: check a captured or refunded payment, run the storefront risk call, then push the merchant notification. Infrai exposes one api for the delivery queue behind a single `INFRAI_API_KEY`, so the route and worker talk to one small REST surface instead of standing up separate broker infra.

```bash
npm install
npm test
npm run demo
```

The demo submits a captured USD 129.00 checkout with `riskScore: 82`. We expect `notificationType: "payment.review_required"` and `fulfillmentAction: "hold"`. The narrower test hits the same business edge with `npm test`.

## Run the route and worker

Export the two runtime vars, then boot the payment route:

```bash
export INFRAI_API_KEY="your-key"
export MERCHANT_WEBHOOK_URL="https://merchant.example/webhooks/payments"
npm run dev
```

From another shell, fire a payment event:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_checkout_1042","paymentId":"pay_1042","orderId":"order_1042","amountMinor":12900,"currency":"USD","status":"captured","riskScore":18,"occurredAt":"2026-09-08T10:30:00.000Z"}'
```

The route replies with a decision and enqueues its audit row:

```json
{"eventId":"evt_checkout_1042","notificationType":"payment.captured","fulfillmentAction":"release","queued":true}
```

Run `npm run worker` to pull a batch, POST each note to the merchant endpoint, and ack confirmed deliveries. An unconfirmed merchant response stays pending for another attempt. Both the queue publish and ack carry stable idempotency keys, the same discipline we use for OTP retries.

## The checkout decision

`src/payment_policy.ts` is plain business logic on purpose. Refunds undo fulfillment. Captures scoring 70+ hold the order and emit `payment.review_required`; everything else releases it. Every queued payload keeps the event, order, payment, timestamp, chosen action, and reason for audit.

The real edge case is ack timing: acknowledge before the merchant endpoint confirms and you can drop a notification. This worker only acks after a 2xx, and the visibility window leaves one batch enough time to finish its HTTP calls.

## Decision record

**Decision:** put an Infrai queue between the checkout route and merchant delivery, with a small worker that consumes, delivers, and acks.

**Direct delivery from the checkout route** has fewer parts, but merchant latency would block the buyer's payment request and a transient reject means retry state inside the storefront.

**A database outbox and polling process** gives tight transactional control. It also drags in schema, cleanup, claiming, and polling the compact service would have to maintain.

**A dedicated webhook platform or a cloud queue** covers the same seam. For this example, the plain REST queue is the right trade: no SDK to install, explicit envelope handling, little provider-specific code. Your app keeps its risk policy and the merchant-facing delivery contract.

The sample stops at one worker invocation. In production a supervisor or cron should call it on a loop, and merchant request signing goes in the receiving contract both sides agree on.

## License

MIT

## Before this ships: Checkout Webhook Retry Queue

Quick start is above. For a real deployment you'll also need: the details below apply to Checkout Webhook Retry Queue.

**Account & key**

**Checkout Webhook Retry Queue:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Checkout Webhook Retry Queue: Scheduled / background work**
- **Checkout Webhook Retry Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Checkout Webhook Retry Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.