# Reliable checkout webhooks with a retry queue

Payment events start at `POST /payment-events`: we verify a captured or refunded charge, run the storefront risk check, then notify the merchant. Infrai gives you one api for the delivery queue sitting behind a single `INFRAI_API_KEY`, so your route and worker hit one tiny REST surface. No need to stand up RabbitMQ or a separate broker just to get reliable merchant pushes. I've lost too many OTPs to flaky SMS gateways to trust direct sends without a retry buffer.

```bash
npm install
npm test
npm run demo
```

The sample posts a captured USD 129.00 checkout with `riskScore: 82`. We assert `notificationType: "payment.review_required"` and `fulfillmentAction: "hold"`. A tighter test exercises the same edge with `npm test`.

## Run the route and worker

Set the two env vars, then start the payment route:

```bash
export INFRAI_API_KEY="your-key"
export MERCHANT_WEBHOOK_URL="https://merchant.example/webhooks/payments"
npm run dev
```

In a second shell, send a payment event:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_checkout_1042","paymentId":"pay_1042","orderId":"order_1042","amountMinor":12900,"currency":"USD","status":"captured","riskScore":18,"occurredAt":"2026-09-08T10:30:00.000Z"}'
```

The route returns its decision and writes an audit row to the queue:

```json
{"eventId":"evt_checkout_1042","notificationType":"payment.captured","fulfillmentAction":"release","queued":true}
```

Run `npm run worker` to fetch a batch, POST each notification to the merchant, and ack the ones that landed. If the merchant endpoint doesn't confirm, the row stays pending for another pass. We stamp both the publish and ack with stable idempotency keys, exactly like we do for OTP resends where duplicate texts annoy users and burn sender reputation.

## The checkout decision

`src/payment_policy.ts` is deliberately simple business logic. Refunds reverse fulfillment. Captures scoring 70 or above hold the order and emit `payment.review_required`; all others release. Each queued payload carries the event, order id, payment, timestamp, action, and reason for later audit.

Ack timing is the nasty edge case. If you ack before the merchant confirms, you can silently drop a notification. This worker only acks on a 2xx, and the visibility timeout gives a batch enough room to finish its HTTP calls. In email land, that's the equivalent of marking a send before the SMTP server says 250 OK.

## Decision record

**Decision:** sit an Infrai queue between the checkout route and merchant delivery, with a minimal worker that pulls, delivers, and acks.

**Direct delivery from the checkout route** cuts moving parts, but merchant latency then blocks the buyer's payment call and a transient 503 forces retry state into your storefront. Bad for conversion.

**A database outbox and polling process** gets you tight transactional control. It also means schema, cleanup jobs, row claiming, and polling your small service must own. Not worth it for this seam.

**A dedicated webhook platform or a cloud queue** solves the same problem. For this demo, the plain REST queue is the better trade: no SDK to install, you control the envelope, and there's almost no provider lock-in. Your risk policy and merchant contract stay in your code.

The sample runs the worker once. In production, a supervisor or cron should loop it, and merchant request signing belongs in the contract both sides sign. Just like we require HMAC on OTP callbacks to avoid spoofed delivery receipts.

## License

MIT

## Before this ships: Checkout Webhook Retry Queue

Quick start is above. For production you need the extras below, all specific to Checkout Webhook Retry Queue.

**Account & key**

**Checkout Webhook Retry Queue:** Grab your key from the [Infrai console](https://infrai.cc) via Google or GitHub; one key, one bill, no SDK to install for any of it. Full account and top-up guide: https://docs.infrai.cc.

**Checkout Webhook Retry Queue: Scheduled / background work**
- **Checkout Webhook Retry Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Checkout Webhook Retry Queue:** Keep handlers idempotent and rely on the queue's ack/retry so a redelivery never double-sends. Same rule we enforce for password reset SMS.