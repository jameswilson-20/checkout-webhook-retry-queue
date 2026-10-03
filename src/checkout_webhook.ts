import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai_queue.js";
import { decideNotification, paymentEventSchema } from "./payment_policy.js";

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payment-events") {
    json(response, 404, { error: "route not found" });
    return;
  }

  try {
    const event = paymentEventSchema.parse(await readJson(request));
    const notification = decideNotification(event);
    await infrai.queue.publish(notification, `payment-event:${event.eventId}`);
    json(response, 202, {
      eventId: event.eventId,
      notificationType: notification.notificationType,
      fulfillmentAction: notification.fulfillmentAction,
      queued: true,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "invalid payment event" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: error.code, message: error.message });
      return;
    }
    json(response, 503, { error: "notification queue unavailable" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`payment event route listening on http://localhost:${port}`));
}
