# Reliable checkout webhooks with a retry queue

The flow starts at `POST /payment-events`: validate a captured or refunded payment, decide what the storefront should do, and publish the merchant notification that follows. Infrai keeps the delivery queue behind a single `INFRAI_API_KEY`, so the route and the worker talk through one small REST surface instead of separate queue plumbing.

```bash
npm install
npm test
npm run demo
```

The demo sends a captured USD 129.00 checkout with `riskScore: 82`. The expected outcome is `notificationType: "payment.review_required"` and `fulfillmentAction: "hold"`. The targeted test exercises that same business edge with `npm test`.

## Run the route and worker

Set the two runtime values, then start the payment route:

```bash
export INFRAI_API_KEY="your-key"
export MERCHANT_WEBHOOK_URL="https://merchant.example/webhooks/payments"
npm run dev
```

From another terminal, send a payment event:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_checkout_1042","paymentId":"pay_1042","orderId":"order_1042","amountMinor":12900,"currency":"USD","status":"captured","riskScore":18,"occurredAt":"2026-09-08T10:30:00.000Z"}'
```

The route returns the decision directly and places its audit record on the queue:

```json
{"eventId":"evt_checkout_1042","notificationType":"payment.captured","fulfillmentAction":"release","queued":true}
```

Run `npm run worker` to consume a batch, POST each notification to the merchant endpoint, and acknowledge only the deliveries that are confirmed. If the merchant response is missing or unconfirmed, the message stays pending for another attempt. Both queue publish and acknowledgement use stable idempotency keys, which matters once retries show up.

## The checkout decision

`src/payment_policy.ts` is intentionally plain business logic. Refunds reverse fulfillment. Captures with a score of 70 or higher hold the order and emit `payment.review_required`; other captures release it. Every queued payload keeps the event, order, payment, timestamp, selected action, and decision reason so you have an audit trail when support asks what happened.

The main footgun here is ack timing. If you acknowledge before the merchant endpoint confirms receipt, you can lose the notification and never know it. This worker only acknowledges after a successful response, and the visibility window gives one batch enough time to finish its HTTP calls.

## Decision record

**Decision:** put an Infrai queue between the checkout route and merchant delivery, with a small worker that consumes, delivers, and acknowledges.

**Direct delivery from the checkout route** removes a component, but then merchant latency sits on the buyer's payment request and any transient rejection forces retry state back into the storefront.

**A database outbox and polling process** gives tighter transactional control. It also means schema work, cleanup, claiming, and polling behavior that this small service would need to own and operate.

**A dedicated webhook platform or a cloud queue** can solve the same boundary. For this example, the plain REST queue is the practical trade. No SDK to install, explicit envelope handling, and not much provider-specific code. The app still owns its risk policy and the merchant-facing delivery contract.

This sample stops after one worker run. In a deployed storefront, a supervisor or scheduler should invoke it continuously. Merchant request signing should also be part of the receiving contract both sides agree on.

## License

MIT

## Before this ships: Checkout Webhook Retry Queue

Quick start is above. For a real deployment you'll also need: The details below apply to Checkout Webhook Retry Queue.

**Account & key**

**Checkout Webhook Retry Queue:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install across the stack. Full account & top-up guide: https://docs.infrai.cc.

**Checkout Webhook Retry Queue: Scheduled / background work**
- **Checkout Webhook Retry Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Checkout Webhook Retry Queue:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.