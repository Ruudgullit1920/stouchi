'use strict';

const { PostHog } = require('posthog-node');

/* One client per process, not per call: no setup cost inside the model's time budget. */
let cached = null;

function clientFor(env) {
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_HOST;
  if (!apiKey || !host) return null;
  if (!cached || cached.key !== apiKey || cached.host !== host) {
    /* flushAt 1: each event leaves at once, so a frozen serverless worker loses little. */
    cached = { key: apiKey, host, client: new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 }) };
  }
  return cached.client;
}

/** Records one provider request as an AI Observability generation. Never awaits the network
 * and never throws: observability must not slow down or break the request.
 * Prompt and reply text are household budget data, so they are sent only when
 * POSTHOG_CAPTURE_CONTENT=1. */
function captureAiGeneration({
  env,
  distinctId,
  sessionId,
  traceId,
  provider,
  model,
  input,
  output,
  usage,
  latency,
  httpStatus,
  isError = false,
}) {
  try {
    const client = clientFor(env);
    if (!client) return;
    const content = env.POSTHOG_CAPTURE_CONTENT === '1';
    client.capture({
      distinctId: distinctId ?? sessionId ?? traceId,
      event: '$ai_generation',
      properties: {
        $ai_trace_id: traceId,
        $ai_session_id: sessionId,
        $ai_model: model,
        $ai_provider: provider,
        $ai_input: content ? input : undefined,
        $ai_input_tokens: usage?.prompt_tokens,
        $ai_output_choices: content && output ? [{ role: 'assistant', content: output }] : undefined,
        $ai_output_tokens: usage?.completion_tokens,
        $ai_latency: latency,
        $ai_http_status: httpStatus,
        $ai_is_error: isError,
      },
    });
  } catch (error) {
    if (env.NODE_ENV === 'development') console.warn('[posthog] AI generation capture failed', error);
  }
}

module.exports = { captureAiGeneration };
