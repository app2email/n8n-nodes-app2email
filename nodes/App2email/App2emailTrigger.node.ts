import { createHmac, timingSafeEqual } from 'crypto';
import {
	NodeConnectionType,
	type IDataObject,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type IWebhookSetupMethods,
} from 'n8n-workflow';

const API_BASE = 'https://api.app2email.com/v1';

// A signed event older (or newer) than this is refused, to stop replays.
const TOLERANCE_SECONDS = 300;

// Calls the app2email API for this workflow's credential (hook functions only: setup and removal).
async function app2emailRequest(
	this: IHookFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
): Promise<any> {
	const credentials = await this.getCredentials('app2emailApi');
	const options: IHttpRequestOptions = {
		method,
		url: `${API_BASE}/${String(credentials.number)}${path}`,
		body,
		json: true,
	};
	return this.helpers.httpRequestWithAuthentication.call(this, 'app2emailApi', options);
}

// X-App2email-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
function signatureIsValid(signatureHeader: string, rawBody: Buffer, secret: string): boolean {
	const parts = signatureHeader.split(',').map((part) => part.trim());
	const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2));
	const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));

	if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
	if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

	const payload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
	const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'), 'hex');

	return signatures.some((signature) => {
		const given = Buffer.from(signature, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

export class App2emailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'app2email Trigger',
		name: 'app2emailTrigger',
		icon: 'file:app2email.svg',
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when app2email sends an event (message status, incoming message, opt-out ...)',
		defaults: {
			name: 'app2email Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'app2emailApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['message.status', 'message.received', 'contact.opted_out', 'broadcast.completed'],
				options: [
					{ name: 'Approval Resolved', value: 'approval.resolved' },
					{ name: 'Broadcast Completed', value: 'broadcast.completed' },
					{ name: 'Contact Opted Out', value: 'contact.opted_out' },
					{ name: 'Contact Updated', value: 'contact.updated' },
					{ name: 'Conversation Handed Over (Owner Changed)', value: 'conversation.owner_changed' },
					{ name: 'Message Failed', value: 'message.failed' },
					{ name: 'Message Held for Approval', value: 'message.held_for_approval' },
					{ name: 'Message Received', value: 'message.received' },
					{ name: 'Message Status Changed', value: 'message.status' },
					{ name: 'Template Status Changed', value: 'template.status_changed' },
					{ name: 'Usage Threshold', value: 'usage.threshold' },
				],
				description: 'The events that run this workflow. app2email sends every event to every webhook; the others are answered and skipped.',
			},
		],
	};

	// Setup and removal: the webhook is created in app2email when the workflow is activated,
	// and deleted when it is deactivated. Its id and signing secret are kept in workflow static data.
	webhookMethods: IWebhookSetupMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (!staticData.webhookId) return false;
				const response = await app2emailRequest.call(this, 'GET', '/webhooks');
				const webhooks = (response.webhooks as Array<{ id: string }>) ?? [];
				return webhooks.some((webhook) => webhook.id === staticData.webhookId);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				// every webhook gets every event: the chosen events are checked in webhook() below
				const response = await app2emailRequest.call(this, 'POST', '/webhooks', {
					url: webhookUrl,
				});
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = response.webhook.id as string;
				staticData.secret = response.webhook.secret as string;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId) {
					try {
						await app2emailRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(staticData.webhookId))}`);
					} catch {
						// Already removed in app2email: nothing more to do.
					}
				}
				delete staticData.webhookId;
				delete staticData.secret;
				return true;
			},
		},
	};

	// Each delivery: verify the signature, then output the event's data.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const staticData = this.getWorkflowStaticData('node');
		const secret = staticData.secret as string | undefined;
		const signature = request.headers['x-app2email-signature'];
		// n8n keeps the unparsed JSON body on the request. The signature is over these exact bytes.
		const rawBody = (request as unknown as { rawBody?: Buffer | string }).rawBody;

		const reject = (status: number, message: string): IWebhookResponseData => {
			response.status(status).json({ error: message });
			return { noWebhookResponse: true };
		};

		if (!secret) return reject(401, 'webhook has no secret: deactivate and activate the workflow again');
		if (typeof signature !== 'string') return reject(401, 'missing X-App2email-Signature');
		if (rawBody === undefined) return reject(400, 'raw body not available');

		const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
		if (!signatureIsValid(signature, bytes, secret)) return reject(401, 'invalid signature');

		const body = (request.body ?? {}) as IDataObject;
		const data = (body.data ?? {}) as IDataObject;

		// app2email sends every event to every webhook: answer the ones this trigger is not set up for, without running the workflow
		const events = this.getNodeParameter('events', []) as string[];
		if (events.length > 0 && !events.includes(String(body.type ?? ''))) {
			response.status(200).json({ received: true, skipped: body.type ?? null });
			return { noWebhookResponse: true };
		}

		// the event's data, plus its type, id and time so one trigger can serve several event types
		return {
			workflowData: [this.helpers.returnJsonArray({ ...data, event_type: body.type, event_id: body.id, event_created: body.created })],
		};
	}
}
