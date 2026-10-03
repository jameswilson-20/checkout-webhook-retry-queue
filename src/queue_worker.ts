import { z } from "zod";
import { infrai } from "./infrai_queue.js";
import { paymentEventSchema } from "./payment_policy.js";

const notificationSchema = paymentEventSchema.extend({
  notificationType: z.enum(["payment.captured", "payment.refunded", "payment.review_required"]),
  fulfillmentAction: z.enum(["release", "hold", "reverse"]),
  decisionReason: z.string().min(1),
});

export async function deliverBatch(): Promise<{ delivered: number; pending: number }> {
  const destination = process.env.MERCHANT_WEBHOOK_URL;
  if (!destination) throw new Error("Set MERCHANT_WEBHOOK_URL before running the worker");

  const batch = await infrai.queue.consume(10, 60);
  let delivered = 0;
  let pending = 0;

  for (const message of batch.messages ?? []) {
    const notification = notificationSchema.parse(message.payload);
    const response = await fetch(destination, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": notification.eventId,
      },
      body: JSON.stringify(notification),
    });

    if (response.ok) {
      await infrai.queue.ack(message.message_id);
      delivered += 1;
    } else {
      pending += 1;
    }
  }
  return { delivered, pending };
}

if (process.env.NODE_ENV !== "test") {
  deliverBatch().then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
