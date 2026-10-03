import { z } from "zod";

export const paymentEventSchema = z.object({
  eventId: z.string().min(1),
  paymentId: z.string().min(1),
  orderId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(["captured", "refunded"]),
  riskScore: z.number().min(0).max(100),
  occurredAt: z.string().datetime(),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type DeliveryNotification = PaymentEvent & {
  notificationType: "payment.captured" | "payment.refunded" | "payment.review_required";
  fulfillmentAction: "release" | "hold" | "reverse";
  decisionReason: string;
};

export function decideNotification(event: PaymentEvent): DeliveryNotification {
  if (event.status === "refunded") {
    return {
      ...event,
      notificationType: "payment.refunded",
      fulfillmentAction: "reverse",
      decisionReason: "refund recorded",
    };
  }

  if (event.riskScore >= 70) {
    return {
      ...event,
      notificationType: "payment.review_required",
      fulfillmentAction: "hold",
      decisionReason: "risk score reached review threshold",
    };
  }

  return {
    ...event,
    notificationType: "payment.captured",
    fulfillmentAction: "release",
    decisionReason: "capture accepted below review threshold",
  };
}
