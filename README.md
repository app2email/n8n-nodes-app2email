# n8n-nodes-app2email

n8n community nodes for [app2email](https://www.app2email.com): send and read WhatsApp Business messages, look after contacts, conversations, broadcasts and templates, hand conversations to a person, and start workflows from app2email events.

Status: written against `n8n-workflow` 1.60; compiled with `tsc` but not yet run inside n8n. Run `npm install && npm run build && npm run lint` and test in a local n8n before publishing.

## What is in the package

- **app2email** node (action). Resources and operations:
  - Message: Send Template, Send Text Reply, Send Buttons or List (interactive), Get Status, List
  - Conversation: Get (window state, owner), List, List Messages, Set Owner (hand over to a person / agent / paused / default)
  - Contact: Create or Update, Get, List, Record Consent
  - Approval: List, Approve, Reject (sends held by an API key's approval threshold)
  - Broadcast: List, Get, Cancel
  - Template: List, Get
  - Do Not Call: Add, Check, Remove
  - Contact Opt-In: Add, Remove
  - Usage: Get
- **app2email Trigger** node (webhook): creates an app2email webhook when the workflow is activated, verifies every event's signature, and outputs the event's `data` plus `event_type`, `event_id` and `event_created`. app2email sends every event to every webhook; the trigger runs the workflow only for the events chosen in it and answers the rest with 200. Events: Message Received, Message Status Changed, Message Failed, Contact Opted Out, Contact Updated, Conversation Handed Over, Message Held for Approval, Approval Resolved, Broadcast Completed, Template Status Changed, Usage Threshold.
- **app2email API** credential: API key and WhatsApp number. "Test" calls `GET /v1/{number}/me`.

## Install (after publishing to npm)

1. In n8n open **Settings > Community Nodes > Install**.
2. Enter `n8n-nodes-app2email` and confirm.
3. Create a credential of type **app2email API** (key from https://www.app2email.com/dashboard/apikey; a sandbox key simulates sends).

For a local test before publishing: `npm install && npm run build`, then `npm link` here and `npm link n8n-nodes-app2email` in `~/.n8n/custom`, restart n8n.

## Example workflows

- **Order shipped**: Shopify / WooCommerce trigger → app2email (Message > Send Template `order_update`, body values name and order number).
- **Reply to incoming messages with an LLM**: app2email Trigger (Message Received) → app2email (Conversation > Get: skip when `owner` is human) → OpenAI / Anthropic node → app2email (Message > Send Text Reply, Reply To = the incoming `message_id`).
- **Escalate to a person**: IF the model answer contains "handoff" → app2email (Conversation > Set Owner = human, summary = the model's summary) → Slack message with `conversation_url`.
- **Approval desk**: app2email Trigger (Message Held for Approval) → Slack approval → app2email (Approval > Approve or Reject).
- **CRM sync**: HubSpot / Pipedrive trigger → app2email (Contact > Create or Update with tags and custom fields); app2email Trigger (Contact Opted Out) → CRM unsubscribe.
- **Daily usage check**: Schedule → app2email (Usage > Get) → IF `whatsapp_messages.left` is low → email.

## Trigger signature check

Every event carries `X-App2email-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, signed with the webhook secret app2email returns when the webhook is created. The trigger checks it with that secret and rejects events older than 5 minutes with HTTP 401. The check reads the raw request body (`rawBody` on the request), which depends on the n8n version: test this first.

## Publish and get verified

1. `npm install`, `npm run build`, `npm run lint` (the n8n community-node ESLint rules are the same ones the Creator Portal runs; fix every error).
2. `npm publish --access public` as `n8n-nodes-app2email` (name free on npm as of 2 Nov 2026). The package must carry the `n8n-community-node-package` keyword and the `n8n` block (it does).
3. Submit for verification on the n8n Creator Portal (https://creators.n8n.io): a verified node is installable on n8n Cloud and listed in the nodes panel. Requirements: MIT licence (set), no runtime dependencies (none), lint passes, a README with examples, the `app2email.svg` icon, and a test account for the n8n team (an app2email number with a sandbox key).
4. Publish provenance from GitHub Actions is optional; a `publish-npm.yml` like the one in `../js/.github/workflows/` works unchanged.

## Notes

- The trigger needs a public `https://` n8n address. app2email will not deliver to `localhost`.
- Template sends and broadcasts follow the app2email rules: free-form text only inside the 24 hour window, marketing templates are skipped for Do Not Call numbers.
- Conversation > Get before answering as a bot: when `owner` is `human` or `paused`, a person has the conversation.
