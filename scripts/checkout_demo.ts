import { decideNotification, paymentEventSchema } from "../src/payment_policy.js";

const event = paymentEventSchema.parse({
  eventId: "evt_checkout_1042",
  paymentId: "pay_1042",
  orderId: "order_1042",
  amountMinor: 12900,
  currency: "USD",
  status: "captured",
  riskScore: 82,
  occurredAt: "2026-09-08T10:30:00.000Z",
});

console.log(JSON.stringify(decideNotification(event), null, 2));
