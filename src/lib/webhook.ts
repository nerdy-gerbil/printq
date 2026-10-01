import "server-only";

/**
 * The optional outbound webhook.
 *
 * Set `WEBHOOK_URL` to a Discord "Incoming Webhook" (or any Slack-compatible
 * incoming webhook) and every event that already reaches a recipient's
 * in-app Activity feed is posted there too. The webhook is a *mirror*, never
 * the source: nothing is written only because a webhook exists, and nothing
 * in the notification flow depends on delivery succeeding.
 *
 * Best-effort by design, like the audit trail in the other direction — a
 * slow or dead webhook must not slow or break the action the user asked
 * for. Fire with a short timeout, swallow every failure loudly into a log
 * line, and never await this from anything latency-sensitive.
 */

export function webhookConfigured(): boolean {
  return Boolean(process.env.WEBHOOK_URL);
}

/**
 * Post one event. Fire-and-forget; call sites do not await it unless they
 * want the guarantee of the log line having happened.
 */
export function postWebhook(text: string): void {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  // Discord takes { content }, Slack's legacy incoming webhook takes { text }.
  // Discord accepts { text } too, so one shape serves both.
  const body = JSON.stringify({ text });

  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(5_000),
  }).catch((error) => {
    console.error("[webhook] post failed:", error instanceof Error ? error.message : error);
  });
}
