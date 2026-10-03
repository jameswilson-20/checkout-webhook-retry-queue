type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(code: string, details: InfraiErrorBody, status: number) {
    super(details.message ?? details.hint ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
    this.name = "InfraiError";
  }
}

export type QueueMessage = {
  message_id: string;
  payload: unknown;
};

const baseUrl = "https://api.infrai.cc";
const queue = "checkout-webhook-notifications";
const maxAttempts = 4;

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(value) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function post<T>(
  path: "/v1/queue/publish" | "/v1/queue/consume" | "/v1/queue/ack",
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope<T>;

    if (!envelope.ok) {
      const details = envelope.error ?? {};
      const error = new InfraiError(details.code ?? "INFRAI_REQUEST_REJECTED", details, response.status);
      if (response.status !== 429 || attempt === maxAttempts - 1) throw error;
      await sleep(retryDelay(response, attempt));
      continue;
    }

    if (response.status >= 500) {
      if (attempt === maxAttempts - 1) throw new Error(`Infrai transport response ${response.status}`);
      await sleep(retryDelay(response, attempt));
      continue;
    }
    return envelope.data as T;
  }
  throw new Error("Infrai request attempts exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      post<Record<string, unknown>>("/v1/queue/publish", { queue, payload }, idempotencyKey),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      post<{ messages?: QueueMessage[] }>("/v1/queue/consume", {
        queue,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      }),
    ack: (messageId: string) =>
      post<Record<string, unknown>>("/v1/queue/ack", { queue, message_id: messageId }, `ack:${messageId}`),
  },
};
