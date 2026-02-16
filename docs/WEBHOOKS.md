# Webhooks

AgentCo can send HTTP notifications when task and alert events occur. There are two systems:

1. **Generic webhooks** — send structured JSON payloads to any HTTP endpoint
2. **OpenClaw provider** — a purpose-built integration for the OpenClaw wake/agent API

Both subscribe to the same internal event stream and can run simultaneously.

---

## Event Types

Both systems use the same set of event types for filtering:

| Event Type | Trigger |
|---|---|
| `task.status_changed` | Any task status transition |
| `task.failed` | Task entered `failed` status |
| `task.completed` | Task entered `agent_done` status |
| `alert.needs_input` | Agent is asking a question |
| `alert.needs_permission` | Agent needs permission to proceed |
| `alert.agent_complete` | Agent finished its turn |
| `alert.action_required` | Post-completion analysis found issues |
| `alert.error` | An error occurred |
| `alert.preview_live` | Dev preview server is ready |
| `alert.pr_created` | Pull request was created |

Note: `task.failed` and `task.completed` are subsets of `task.status_changed`. Subscribing to `task.status_changed` covers all status transitions including failures and completions.

---

## Generic Webhooks

Generic webhooks send a standard JSON envelope to any URL. Manage them via the API or directly in `~/.agentco/config.json`.

### Configuration

In `~/.agentco/config.json`:

```json
{
  "webhooks": [
    {
      "id": "whk_abc123def456",
      "url": "https://example.com/webhook",
      "events": ["task.failed", "alert.needs_input", "alert.agent_complete"],
      "active": true,
      "headers": {
        "Authorization": "Bearer sk-your-token",
        "X-Custom-Header": "some-value"
      },
      "secret": "optional-hmac-secret"
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `id` | Auto-generated | Unique identifier (assigned on creation via API) |
| `url` | Yes | Endpoint to POST to |
| `events` | Yes | Array of event types to subscribe to |
| `active` | Yes | Enable/disable without removing |
| `headers` | No | Custom headers sent with every request (use for auth, API keys, etc.) |
| `secret` | No | HMAC-SHA256 secret for payload signing |

### Payload Format

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-02-16T12:00:00.000Z",
  "event": "task.status_changed",
  "data": {
    "taskId": "abc-123",
    "status": "agent_done"
  }
}
```

For alert events, `data` includes the full alert:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-02-16T12:00:00.000Z",
  "event": "alert.needs_input",
  "data": {
    "taskId": "abc-123",
    "alert": {
      "id": "def-456",
      "type": "needs_question",
      "message": "Agent is asking: Which database?",
      "metadata": { "questionID": "q-789", "sessionID": "s-012" },
      "createdAt": "2026-02-16T12:00:00.000Z"
    }
  }
}
```

### Headers

Every delivery includes:

| Header | Description |
|---|---|
| `Content-Type` | `application/json` |
| `X-AgentCo-Event` | The event type (e.g. `task.status_changed`) |
| `X-AgentCo-Delivery` | Unique delivery ID (UUID) |
| `X-AgentCo-Signature` | `sha256=<hex>` HMAC signature (only if `secret` is configured) |

Custom `headers` from the webhook config are merged in and override the defaults.

### Signature Verification

If a `secret` is set, the payload body is signed with HMAC-SHA256. To verify:

```javascript
const crypto = require("crypto");

function verify(body, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Retry Behavior

Failed deliveries are retried up to 3 times with exponential backoff:

- Attempt 1: immediate
- Attempt 2: after 2 seconds
- Attempt 3: after 8 seconds

4xx responses (except 429) are not retried. All retries are in-memory and non-blocking.

### API

#### List webhooks

```
GET /api/webhooks
```

Returns all registered webhooks. Secrets and auth headers are redacted in responses.

#### Create a webhook

```
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://example.com/webhook",
  "events": ["task.failed", "alert.needs_input"],
  "headers": { "Authorization": "Bearer sk-your-token" },
  "secret": "optional-hmac-secret"
}
```

#### Update a webhook

```
PATCH /api/webhooks/:id
Content-Type: application/json

{
  "events": ["task.failed", "alert.error"],
  "active": false
}
```

All fields except `id` can be updated.

#### Delete a webhook

```
DELETE /api/webhooks/:id
```

#### Test a webhook

```
POST /api/webhooks/:id/test
```

Sends a test payload to verify connectivity. Returns:

```json
{ "success": true, "statusCode": 200 }
```

or on failure:

```json
{ "success": false, "error": "Connection refused" }
```

---

## OpenClaw

A dedicated integration for [OpenClaw](https://openclaw.ai)'s `/hooks/wake` and `/hooks/agent` endpoints. Unlike generic webhooks, it produces OpenClaw-specific payloads with human-readable text descriptions.

### Configuration

In `~/.agentco/config.json`:

```json
{
  "openclaw": {
    "baseUrl": "https://your-openclaw-instance.example.com",
    "token": "your-bearer-token",
    "events": ["task.failed", "alert.needs_input", "alert.agent_complete"]
  }
}
```

| Field | Required | Description |
|---|---|---|
| `baseUrl` | Yes | Base URL of the OpenClaw instance (paths `/hooks/wake` and `/hooks/agent` are appended) |
| `token` | Yes | Bearer token sent as `Authorization: Bearer <token>` |
| `events` | No | Event type filter. Omit to receive all events. |

### Wake Endpoint

All events currently route to `POST {baseUrl}/hooks/wake` with a text description:

```json
{
  "text": "Task \"Add dark mode\": agent finished",
  "mode": "now"
}
```

Example messages:

| Event | Text |
|---|---|
| Status change | `Task "Add dark mode": agent is running` |
| Plan ready | `Task "Add dark mode": plan is ready for review` |
| Agent question | `Task "Add dark mode": Agent is asking: Which framework?` |
| Failed | `Task "Add dark mode": failed` |
| PR created | `Task "Add dark mode": PR created: https://github.com/...` |

### Agent Endpoint

`POST {baseUrl}/hooks/agent` is implemented but not yet routed to any events automatically. The `sendAgent()` function is exported from `services/openclaw.ts` for programmatic use:

```typescript
import { sendAgent } from "./services/openclaw.js";

await sendAgent({
  message: "Task needs attention: agent is asking a question",
  name: "AgentCo",
  wakeMode: "now",
});
```

Full options: `message`, `name`, `agentId`, `sessionKey`, `wakeMode`, `deliver`, `channel`, `to`, `model`, `thinking`, `timeoutSeconds`.

### Retry Behavior

Same as generic webhooks: 3 attempts with 2s/8s backoff. Non-blocking, fire-and-forget.

---

## Architecture

Both systems plug into the orchestrator's existing event broadcast:

```
lifecycle.ts: updateTaskStatus() / createAlert()
    |
    v
event-monitor.ts: broadcast(WSEvent)
    |
    +---> WebSocket subscribers (TUI)
    +---> webhooks.ts (generic webhooks)
    +---> openclaw.ts (OpenClaw provider)
```

No changes were made to the lifecycle or event monitor. Both webhook systems are pure consumers of the existing event stream.
