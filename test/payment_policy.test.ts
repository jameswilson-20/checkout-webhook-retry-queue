import assert from "node:assert/strict";
import test from "node:test";
import { decideNotification } from "../src/payment_policy.js";

test("a high-risk capture holds fulfillment and requests review", () => {
  const result = decideNotification({
    eventId: "evt_risky_checkout",
    paymentId: "pay_9001",
    orderId: "order_9001",
    amountMinor: 45000,
    currency: "USD",
    status: "captured",
    riskScore: 84,
    occurredAt: "2026-09-08T10:30:00.000Z",
  });

  assert.equal(result.notificationType, "payment.review_required");
  assert.equal(result.fulfillmentAction, "hold");
  assert.equal(result.decisionReason, "risk score reached review threshold");
});
