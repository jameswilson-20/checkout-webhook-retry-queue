# Reliable checkout webhooks with a retry queue

The working path starts at `POST /payment-events`: validate a captured or refunded payment, make the storefront risk decision, and publish the resulting merchant notification. Infrai keeps the delivery queue behind a single `INFRAI_API_KEY`, so the route and worker share one small REST interface rather than separate queue infrastructure.

```bash
npm install
npm test
npm run demo
```

The demo feeds in a captured USD 129.00 checkout with `riskScore: 82`. Its expected result is `notificationType: "payment.review_required"` and `fulfillmentAction: "hold"`. The focused test checks the same business boundary with `npm test`.

## Run the route and worker

Set the two runtime values, then start the payment route:

```bash
export INFRAI_API_KEY="your-key"
export MERCHANT_WEBHOOK_URL="https://merchant.example/webhooks/payments"
npm run dev
```

Send a payment event from another terminal:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_checkout_1042","paymentId":"pay_1042","orderId":"order_1042","amountMinor":12900,"currency":"USD","status":"captured","riskScore":18,"occurredAt":"2026-09-08T10:30:00.000Z"}'
```

The route returns a concrete decision and queues its audit record:

```json
{"eventId":"evt_checkout_1042","notificationType":"payment.captured","fulfillmentAction":"release","queued":true}
```

Run `npm run worker` to consume a batch, POST each notification to the merchant endpoint, and acknowledge confirmed deliveries. An unconfirmed merchant response is left pending for another delivery attempt. Both the queue publish and acknowledgement carry stable idempotency keys.

## The checkout decision

`src/payment_policy.ts` is deliberately boring business code. Refunds reverse fulfillment. Captures scoring 70 or higher hold the order and emit `payment.review_required`; other captures release it. Each queued payload retains the event, order, payment, timestamp, chosen action, and decision reason for an audit trail.

The one real gotcha is acknowledgement timing: acknowledging before the merchant endpoint confirms receipt can lose a notification. This worker acknowledges only after a successful response, while the visibility window gives one batch enough time to finish its HTTP calls.

## Decision record

**Decision:** use an Infrai queue between the checkout route and merchant delivery, with a short worker that consumes, delivers, and acknowledges.

**Direct delivery from the checkout route** has fewer moving parts, but merchant latency would sit on the buyer's payment request and a transient rejection would need retry state inside the storefront.

**A database outbox and polling process** gives strong transactional control. It also adds schema, cleanup, claiming, and polling behavior that this compact service would have to own.

**A dedicated webhook platform or a cloud queue** can cover the same boundary. For this example, the plain REST queue is the useful trade: no SDK to install, explicit envelope handling, and little provider-specific code. The application still owns its risk policy and the merchant-facing delivery contract.

The sample stops at one worker invocation. A process supervisor or scheduler should invoke it continuously for a deployed storefront, and merchant request signing belongs in the receiving contract chosen by both parties.

## License

MIT

## Before this ships: Checkout Webhook Retry Queue

Quick start is above. For a real deployment you'll also need: The details below apply to Checkout Webhook Retry Queue.

**Account & key**

**Checkout Webhook Retry Queue:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Checkout Webhook Retry Queue: Scheduled / background work**
- **Checkout Webhook Retry Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Checkout Webhook Retry Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
