# PostHog AI Observability setup

## Status

**Wired, unverified in PostHog.** The project makes raw OpenAI-compatible HTTP calls rather than using a vendor LLM SDK, so it uses the `ai-observability-manual-capture` workflow. No existing PostHog initialization, product events, identity calls, or dashboards were changed.

## What changed

- Added `posthog-node` for Node server-side manual capture.
- Added `lib/ai-observability.js`, which sends `$ai_generation` events using `POSTHOG_API_KEY` and `POSTHOG_HOST` only when both are configured.
- Instrumented the Aam Salah provider chain in `lib/aam-salah/index.js` and the legacy chat proxy in `lib/chat-context.js`:
  - captures successful calls and provider/fetch failures;
  - includes provider, model, input/output, token usage when returned, latency, and HTTP status;
  - uses the authenticated user ID as the PostHog distinct ID;
  - creates one trace ID per model turn; hedged/fallback calls within that turn share the trace ID.
- Passed the authenticated ID from `src/server/aam/turn.ts` into the Aam Salah pipeline.
- Instrumented the Supabase Edge notification writer through the PostHog ingestion API. Its one-shot notification generations have a trace ID and an explicit `null` AI session ID.
- Rebuilt `supabase/functions/notify-run/core.js` from the updated notification source.
- Added local `POSTHOG_API_KEY` and `POSTHOG_HOST` values to `.env` using the configured project token and EU host. No credentials were written to source code.

## Session, trace, and attribution model

- **Aam Salah and legacy chat:** session IDs are scoped as `aam-{user-id}` and `chat-{user-id}` respectively; traces are newly minted for each submitted turn. The application does not currently provide a durable conversation/thread ID at these server call sites, so a user’s turns share one AI session. If the product later supports concurrent conversations per user, pass its stable conversation ID through and use it for `$ai_session_id`.
- **Notification writer:** each model-generated notification is a one-shot generation, so `$ai_session_id` is explicitly `null`; its authenticated recipient is used as the distinct ID and each generation has its own trace.
- **Tools:** no model-tool dispatch loop is registered in the instrumented paths, so no `$ai_span` events were added.

## Deploy configuration

Configure these existing real values in every server runtime that makes LLM calls:

- Vercel/Node API runtime: `POSTHOG_API_KEY` and `POSTHOG_HOST`
- Supabase Edge Function: `POSTHOG_API_KEY` and `POSTHOG_HOST` as Supabase secrets

Use the same project token and EU ingestion host configured locally. The Supabase function intentionally uses its native `fetch` path because `posthog-node` is not compatible with the Deno Edge runtime.

## Verification completed

- `npm run build:notify` — passed; regenerated the Edge bundle.
- `npm run typecheck` — passed.
- `npm run build` — passed.

## How to verify delivery

1. Deploy the environment variables and code.
2. Sign in to the app and send a message through Aam Salah (the `POST /api/aam` path). Alternatively, trigger a model-backed notification through the scheduled `notify-run` function.
3. Open **AI Observability → Traces** in the PostHog project and inspect the newest trace.
4. Confirm that a chat turn has one trace containing all provider attempts for that turn, that the trace is attributed to the authenticated user, and that a second turn appears in the same AI session. For a notification generation, confirm the trace has no AI session ID.

## Privacy mode

The effective configuration is **prompt and completion capture enabled**. The manual payloads in `lib/ai-observability.js` and `supabase/functions/notify-run/index.ts` include `$ai_input` and `$ai_output_choices`; manual capture does not inherit an SDK `privacyMode` switch.

Before collecting prompts or responses that must not be stored in PostHog, update those two manual capture payloads to omit `$ai_input` and `$ai_output_choices` (and apply the equivalent change to any future manual capture path). This affects future events only and does not remove data already ingested. See [AI Observability privacy mode](https://posthog.com/docs/ai-observability/privacy-mode).
