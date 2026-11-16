import {
	NodeApiError,
	NodeConnectionType,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

const API_BASE = 'https://api.app2email.com/v1';

// Calls https://api.app2email.com/v1/{number}{path} with the app2email API key (see the credential).
async function app2emailRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { qs?: IDataObject; body?: IDataObject; headers?: IDataObject } = {},
): Promise<any> {
	const credentials = await this.getCredentials('app2emailApi');
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${API_BASE}/${String(credentials.number)}${path}`,
		qs: options.qs,
		body: options.body,
		headers: options.headers,
		json: true,
	};
	return this.helpers.httpRequestWithAuthentication.call(this, 'app2emailApi', requestOptions);
}

// Drops empty values so that optional fields are not sent.
function compact(values: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== null && value !== '') result[key] = value;
	}
	return result;
}

// Splits "61412345678, 61498765432" (commas, semicolons or new lines) into a list of numbers.
function splitNumbers(text: string): string[] {
	return text
		.split(/[,;\n]/)
		.map((part) => part.replace(/[^0-9]/g, ''))
		.filter((part) => part !== '');
}

// Lists are paged with next_cursor. returnAll reads every page (up to 200 rows per page).
async function listRows(
	this: IExecuteFunctions,
	path: string,
	key: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = (await app2emailRequest.call(this, 'GET', path, {
			qs: compact({ ...qs, limit: returnAll ? 200 : limit, cursor }),
		})) as IDataObject;
		rows.push(...((page[key] as IDataObject[]) ?? []));
		cursor = typeof page.next_cursor === 'string' ? page.next_cursor : undefined;
		if (!returnAll || !cursor) break;
	}
	return rows;
}

async function runOperation(this: IExecuteFunctions, i: number): Promise<IDataObject | IDataObject[]> {
	const resource = this.getNodeParameter('resource', i) as string;
	const operation = this.getNodeParameter('operation', i) as string;

	switch (`${resource}.${operation}`) {
		// ---- Message
		case 'message.sendTemplate': {
			const components = this.getNodeParameter('components', i, '[]') as string;
			let parsed: unknown;
			try {
				parsed = JSON.parse(components);
			} catch {
				throw new NodeOperationError(this.getNode(), 'Components must be valid JSON, eg [] or [{"type":"body","parameters":[...]}]', { itemIndex: i });
			}
			const template: IDataObject = {
				name: this.getNodeParameter('templateName', i) as string,
				language: { code: this.getNodeParameter('languageCode', i, 'en') as string },
			};
			if (Array.isArray(parsed) && parsed.length > 0) template.components = parsed as IDataObject[];
			const dryRun = this.getNodeParameter('dryRun', i, false) as boolean;
			const idempotencyKey = this.getNodeParameter('idempotencyKey', i, '') as string;
			return app2emailRequest.call(this, 'POST', '/messages', {
				body: compact({
					type: 'template',
					to: this.getNodeParameter('to', i) as string,
					template,
					dry_run: dryRun ? true : undefined,
				}),
				headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
			});
		}
		case 'message.sendText': {
			return app2emailRequest.call(this, 'POST', '/messages', {
				body: compact({
					type: 'text',
					to: this.getNodeParameter('to', i) as string,
					text: { body: this.getNodeParameter('text', i) as string },
					reply_to: this.getNodeParameter('replyTo', i, '') as string,
				}),
			});
		}
		case 'message.sendInteractive': {
			const raw = this.getNodeParameter('interactive', i, '{}') as string;
			let interactive: unknown;
			try {
				interactive = typeof raw === 'string' ? JSON.parse(raw) : raw;
			} catch {
				throw new NodeOperationError(this.getNode(), 'Interactive must be valid JSON (a WhatsApp Cloud API interactive object)', { itemIndex: i });
			}
			return app2emailRequest.call(this, 'POST', '/messages', {
				body: { type: 'interactive', to: this.getNodeParameter('to', i) as string, interactive },
			});
		}
		case 'message.getStatus': {
			const messageId = this.getNodeParameter('messageId', i) as string;
			return app2emailRequest.call(this, 'GET', `/messages/${encodeURIComponent(messageId)}`);
		}
		case 'message.list': {
			const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
			const limit = this.getNodeParameter('limit', i, 50) as number;
			const direction = this.getNodeParameter('direction', i, '') as string;
			const since = this.getNodeParameter('since', i, '') as string;
			return listRows.call(this, '/messages', 'messages', compact({ direction, since }), returnAll, limit);
		}

		// ---- Conversation
		case 'conversation.list': {
			const limit = this.getNodeParameter('limit', i, 50) as number;
			return listRows.call(this, '/conversations', 'conversations', {}, false, limit);
		}
		case 'conversation.get': {
			const phone = this.getNodeParameter('phone', i) as string;
			return app2emailRequest.call(this, 'GET', `/conversations/${encodeURIComponent(phone)}`);
		}
		case 'conversation.setOwner': {
			const phone = this.getNodeParameter('phone', i) as string;
			const untilMinutes = this.getNodeParameter('untilMinutes', i, 0) as number;
			return app2emailRequest.call(this, 'PUT', `/conversations/${encodeURIComponent(phone)}/owner`, {
				body: compact({
					owner: this.getNodeParameter('owner', i, 'human') as string,
					reason: this.getNodeParameter('reason', i, '') as string,
					summary: this.getNodeParameter('summary', i, '') as string,
					until_minutes: untilMinutes > 0 ? untilMinutes : undefined,
				}),
			});
		}
		case 'conversation.listMessages': {
			const phone = this.getNodeParameter('phone', i) as string;
			const limit = this.getNodeParameter('limit', i, 50) as number;
			return listRows.call(this, `/conversations/${encodeURIComponent(phone)}/messages`, 'messages', {}, false, limit);
		}

		// ---- Broadcast
		case 'broadcast.list': {
			const response = (await app2emailRequest.call(this, 'GET', '/broadcasts', {
				qs: compact({ limit: this.getNodeParameter('limit', i, 50) as number }),
			})) as IDataObject;
			return (response.broadcasts as IDataObject[]) ?? [];
		}
		case 'broadcast.get': {
			const code = this.getNodeParameter('code', i) as string;
			return app2emailRequest.call(this, 'GET', `/broadcasts/${encodeURIComponent(code)}`);
		}
		case 'broadcast.cancel': {
			const code = this.getNodeParameter('code', i) as string;
			return app2emailRequest.call(this, 'POST', `/broadcasts/${encodeURIComponent(code)}/cancel`);
		}

		// ---- Template
		case 'template.list': {
			const response = (await app2emailRequest.call(this, 'GET', '/templates')) as IDataObject;
			return (response.templates as IDataObject[]) ?? [];
		}
		case 'template.get': {
			const name = this.getNodeParameter('name', i) as string;
			return app2emailRequest.call(this, 'GET', `/templates/${encodeURIComponent(name)}`);
		}

		// ---- Do Not Call
		case 'doNotCall.add': {
			const numbers = splitNumbers(this.getNodeParameter('numbers', i) as string);
			return app2emailRequest.call(this, 'POST', '/donotcall', { body: { numbers } });
		}
		case 'doNotCall.remove': {
			const phone = this.getNodeParameter('phone', i) as string;
			return app2emailRequest.call(this, 'DELETE', `/donotcall/${encodeURIComponent(phone)}`);
		}
		case 'doNotCall.check': {
			const number = this.getNodeParameter('number', i) as string;
			return app2emailRequest.call(this, 'GET', '/donotcall', { qs: { number } });
		}

		// ---- Contact opt-in
		case 'optIn.add': {
			const numbers = splitNumbers(this.getNodeParameter('numbers', i) as string);
			return app2emailRequest.call(this, 'POST', '/optins', { body: { numbers } });
		}
		case 'optIn.remove': {
			const phone = this.getNodeParameter('phone', i) as string;
			return app2emailRequest.call(this, 'DELETE', `/optins/${encodeURIComponent(phone)}`);
		}

		// ---- Contact
		case 'contact.upsert': {
			const tagsRaw = this.getNodeParameter('tags', i, '') as string;
			const customRaw = this.getNodeParameter('customFields', i, '{}') as string;
			let customFields: unknown = undefined;
			if (customRaw && customRaw !== '{}') {
				try {
					customFields = typeof customRaw === 'string' ? JSON.parse(customRaw) : customRaw;
				} catch {
					throw new NodeOperationError(this.getNode(), 'Custom Fields must be a JSON object', { itemIndex: i });
				}
			}
			return app2emailRequest.call(this, 'POST', '/contacts', {
				body: compact({
					identity: this.getNodeParameter('identity', i) as string,
					name: this.getNodeParameter('name', i, '') as string,
					tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
					custom_fields: customFields,
					source: 'n8n',
				}),
			});
		}
		case 'contact.get': {
			const identity = this.getNodeParameter('identity', i) as string;
			return app2emailRequest.call(this, 'GET', `/contacts/${encodeURIComponent(identity)}`);
		}
		case 'contact.list': {
			const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
			const limit = this.getNodeParameter('limit', i, 50) as number;
			return listRows.call(this, '/contacts', 'contacts', compact({ q: this.getNodeParameter('q', i, ''), tag: this.getNodeParameter('tag', i, '') }), returnAll, limit);
		}
		case 'contact.consent': {
			const identity = this.getNodeParameter('identity', i) as string;
			return app2emailRequest.call(this, 'POST', `/contacts/${encodeURIComponent(identity)}/consent`, {
				body: compact({
					marketing: this.getNodeParameter('consentMarketing', i, true) as boolean,
					source: this.getNodeParameter('consentSource', i, '') as string,
					text: this.getNodeParameter('consentText', i, '') as string,
					evidence: this.getNodeParameter('consentEvidence', i, '') as string,
				}),
			});
		}

		// ---- Approval
		case 'approval.list': {
			const response = (await app2emailRequest.call(this, 'GET', '/approvals')) as IDataObject;
			return (response.approvals as IDataObject[]) ?? [];
		}
		case 'approval.approve':
		case 'approval.reject': {
			const approvalId = this.getNodeParameter('approvalId', i) as string;
			return app2emailRequest.call(this, 'POST', `/approvals/${encodeURIComponent(approvalId)}/${operation}`, { body: {} });
		}

		// ---- Usage
		case 'usage.get': {
			return app2emailRequest.call(this, 'GET', '/usage');
		}

		default:
			throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}.${operation}`, { itemIndex: i });
	}
}

// Operation fields, shown only for the matching resource and operation.
function when(resource: string, operation?: string): IDataObject {
	return operation
		? { show: { resource: [resource], operation: [operation] } }
		: { show: { resource: [resource] } };
}

const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Approval', value: 'approval' },
			{ name: 'Broadcast', value: 'broadcast' },
			{ name: 'Contact', value: 'contact' },
			{ name: 'Contact Opt-In', value: 'optIn' },
			{ name: 'Conversation', value: 'conversation' },
			{ name: 'Do Not Call', value: 'doNotCall' },
			{ name: 'Message', value: 'message' },
			{ name: 'Template', value: 'template' },
			{ name: 'Usage', value: 'usage' },
		],
		default: 'message',
	},

	// ---- Message
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('message'),
		options: [
			{ name: 'Get Status', value: 'getStatus', action: 'Get the status of a message' },
			{ name: 'List', value: 'list', action: 'List messages' },
			{ name: 'Send Template', value: 'sendTemplate', action: 'Send a template message' },
			{ name: 'Send Text Reply', value: 'sendText', action: 'Send a free-form text message' },
			{ name: 'Send Buttons or List', value: 'sendInteractive', action: 'Send reply buttons or a list menu' },
		],
		default: 'sendTemplate',
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		displayOptions: when('message', 'sendInteractive'),
		default: '',
		placeholder: '61412345678',
		description: 'The contact number with country code, digits only. Only within 24 hours of their last message.',
	},
	{
		displayName: 'Interactive (JSON)',
		name: 'interactive',
		type: 'json',
		required: true,
		displayOptions: when('message', 'sendInteractive'),
		default: '{"type":"button","body":{"text":"Confirm your appointment?"},"action":{"buttons":[{"type":"reply","reply":{"id":"yes","title":"Yes"}},{"type":"reply","reply":{"id":"no","title":"No"}}]}}',
		description: 'The WhatsApp Cloud API interactive object: type button, list or cta_url',
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		displayOptions: when('message', 'sendTemplate'),
		default: '',
		placeholder: '61412345678',
		description: 'Recipient number with country code. Several: separate with commas.',
	},
	{
		displayName: 'Template Name',
		name: 'templateName',
		type: 'string',
		required: true,
		displayOptions: when('message', 'sendTemplate'),
		default: '',
		placeholder: 'order_update',
		description: 'Exact name of an approved template',
	},
	{
		displayName: 'Language Code',
		name: 'languageCode',
		type: 'string',
		displayOptions: when('message', 'sendTemplate'),
		default: 'en',
		description: 'Template language, eg en or en_US',
	},
	{
		displayName: 'Components (JSON)',
		name: 'components',
		type: 'json',
		displayOptions: when('message', 'sendTemplate'),
		default: '[]',
		description:
			'The template values, in the WhatsApp Cloud API format, eg [{"type":"body","parameters":[{"type":"text","text":"John"}]}]. Leave [] for templates without values.',
	},
	{
		displayName: 'Dry Run',
		name: 'dryRun',
		type: 'boolean',
		displayOptions: when('message', 'sendTemplate'),
		default: false,
		description: 'Whether to check everything without sending anything',
	},
	{
		displayName: 'Idempotency Key',
		name: 'idempotencyKey',
		type: 'string',
		displayOptions: when('message', 'sendTemplate'),
		default: '',
		description:
			'Optional. The same key within 24 hours returns the first answer and nothing is sent twice.',
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		displayOptions: when('message', 'sendText'),
		default: '',
		placeholder: '61412345678',
		description: 'Recipient number. Free-form text only works within 24 hours of their last message.',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		displayOptions: when('message', 'sendText'),
		default: '',
		description: 'Up to 4096 characters',
	},
	{
		displayName: 'Reply To Message ID',
		name: 'replyTo',
		type: 'string',
		displayOptions: when('message', 'sendText'),
		default: '',
		description: 'Optional. The message_id (wamid...) of one of the contact messages to quote',
	},
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		required: true,
		displayOptions: when('message', 'getStatus'),
		default: '',
		description: 'The message_id returned when the message was sent',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: when('message', 'list'),
		default: false,
		description: 'Whether to read every page, not only the first',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 200 },
		displayOptions: { show: { resource: ['message', 'conversation', 'broadcast'], operation: ['list', 'listMessages'] }, hide: { returnAll: [true] } },
		default: 50,
		description: 'Max number of results to return',
	},
	{
		displayName: 'Direction',
		name: 'direction',
		type: 'options',
		displayOptions: when('message', 'list'),
		options: [
			{ name: 'Both', value: '' },
			{ name: 'Incoming', value: 'in' },
			{ name: 'Outgoing', value: 'out' },
		],
		default: '',
	},
	{
		displayName: 'Since',
		name: 'since',
		type: 'string',
		displayOptions: when('message', 'list'),
		default: '',
		placeholder: '2026-10-25T10:00:00Z',
		description: 'Optional. ISO 8601 time. Only messages after this time.',
	},

	// ---- Conversation
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('conversation'),
		options: [
			{ name: 'Get', value: 'get', action: 'Get a conversation: window state and owner' },
			{ name: 'List', value: 'list', action: 'List conversations' },
			{ name: 'List Messages', value: 'listMessages', action: 'List messages of one conversation' },
			{ name: 'Set Owner', value: 'setOwner', action: 'Hand a conversation to a person or an agent' },
		],
		default: 'list',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: ['conversation'], operation: ['listMessages', 'get', 'setOwner'] } },
		default: '',
		placeholder: '61412345678',
		description: 'The contact number, with country code (or the business-scoped user id WhatsApp gave)',
	},
	{
		displayName: 'Owner',
		name: 'owner',
		type: 'options',
		displayOptions: when('conversation', 'setOwner'),
		options: [
			{ name: 'Human (a Person Takes Over)', value: 'human' },
			{ name: 'Agent (an Automation Owns It)', value: 'agent' },
			{ name: 'Paused (Nothing Automatic)', value: 'paused' },
			{ name: 'Default Routing', value: '' },
		],
		default: 'human',
		description: 'Human: auto reply and agent forwarding stop; the email bridge and the dashboard take over',
	},
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		displayOptions: when('conversation', 'setOwner'),
		default: '',
		placeholder: 'customer asked for a person',
	},
	{
		displayName: 'Summary',
		name: 'summary',
		type: 'string',
		typeOptions: { rows: 3 },
		displayOptions: when('conversation', 'setOwner'),
		default: '',
		description: 'What was discussed and what is open, for the person taking over',
	},
	{
		displayName: 'Hand Back After (Minutes)',
		name: 'untilMinutes',
		type: 'number',
		displayOptions: when('conversation', 'setOwner'),
		default: 0,
		description: '0 = until changed. Otherwise the conversation returns to the default routing after this many minutes.',
	},

	// ---- Contact
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('contact'),
		options: [
			{ name: 'Create or Update', value: 'upsert', action: 'Create or update a contact' },
			{ name: 'Get', value: 'get', action: 'Get a contact' },
			{ name: 'List', value: 'list', action: 'List or search contacts' },
			{ name: 'Record Consent', value: 'consent', action: 'Record marketing consent with evidence' },
		],
		default: 'upsert',
	},
	{
		displayName: 'Contact',
		name: 'identity',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: ['contact'], operation: ['upsert', 'get', 'consent'] } },
		default: '',
		placeholder: '61412345678',
		description: 'The contact number with country code, digits only',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		displayOptions: when('contact', 'upsert'),
		default: '',
	},
	{
		displayName: 'Tags',
		name: 'tags',
		type: 'string',
		displayOptions: when('contact', 'upsert'),
		default: '',
		placeholder: 'vip, newsletter',
		description: 'Comma separated. Replaces the contact\'s tags. Leave empty to keep them.',
	},
	{
		displayName: 'Custom Fields (JSON)',
		name: 'customFields',
		type: 'json',
		displayOptions: when('contact', 'upsert'),
		default: '{}',
		description: 'String values merged into the contact, eg {"order_id":"1234"}; usable as template values in segment sends',
	},
	{
		displayName: 'Search',
		name: 'q',
		type: 'string',
		displayOptions: when('contact', 'list'),
		default: '',
		description: 'Part of a name or number',
	},
	{
		displayName: 'Tag',
		name: 'tag',
		type: 'string',
		displayOptions: when('contact', 'list'),
		default: '',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: when('contact', 'list'),
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: { show: { resource: ['contact'], operation: ['list'], returnAll: [false] } },
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		description: 'Max number of results to return',
	},
	{
		displayName: 'Consent Given',
		name: 'consentMarketing',
		type: 'boolean',
		displayOptions: when('contact', 'consent'),
		default: true,
		description: 'Whether the person agreed to marketing messages (false withdraws consent)',
	},
	{
		displayName: 'Consent Source',
		name: 'consentSource',
		type: 'string',
		displayOptions: when('contact', 'consent'),
		default: '',
		placeholder: 'web form',
	},
	{
		displayName: 'Consent Text',
		name: 'consentText',
		type: 'string',
		displayOptions: when('contact', 'consent'),
		default: '',
		description: 'The wording the person agreed to',
	},
	{
		displayName: 'Consent Evidence',
		name: 'consentEvidence',
		type: 'string',
		displayOptions: when('contact', 'consent'),
		default: '',
		description: 'A URL, file name, IP address or message ID',
	},

	// ---- Approval
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('approval'),
		options: [
			{ name: 'Approve', value: 'approve', action: 'Approve a held send' },
			{ name: 'List', value: 'list', action: 'List sends waiting for approval' },
			{ name: 'Reject', value: 'reject', action: 'Reject a held send' },
		],
		default: 'list',
	},
	{
		displayName: 'Approval ID',
		name: 'approvalId',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: ['approval'], operation: ['approve', 'reject'] } },
		default: '',
	},
	// ---- Broadcast
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('broadcast'),
		options: [
			{ name: 'Cancel', value: 'cancel', action: 'Cancel a broadcast' },
			{ name: 'Get', value: 'get', action: 'Get a broadcast' },
			{ name: 'List', value: 'list', action: 'List broadcasts' },
		],
		default: 'list',
	},
	{
		displayName: 'Broadcast Code',
		name: 'code',
		type: 'string',
		required: true,
		displayOptions: when('broadcast', 'get'),
		default: '',
	},
	{
		displayName: 'Broadcast Code',
		name: 'code',
		type: 'string',
		required: true,
		displayOptions: when('broadcast', 'cancel'),
		default: '',
		description: 'Only a scheduled or sending API broadcast can be cancelled',
	},

	// ---- Template
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('template'),
		options: [
			{ name: 'Get', value: 'get', action: 'Get a template' },
			{ name: 'List', value: 'list', action: 'List templates' },
		],
		default: 'list',
	},
	{
		displayName: 'Template Name',
		name: 'name',
		type: 'string',
		required: true,
		displayOptions: when('template', 'get'),
		default: '',
	},

	// ---- Do Not Call
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('doNotCall'),
		options: [
			{ name: 'Add', value: 'add', action: 'Add numbers to the do not call list' },
			{ name: 'Check', value: 'check', action: 'Check if a number is on the list' },
			{ name: 'Remove', value: 'remove', action: 'Remove a number from the list' },
		],
		default: 'add',
	},
	{
		displayName: 'Numbers',
		name: 'numbers',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		displayOptions: when('doNotCall', 'add'),
		default: '',
		placeholder: '61412345678, 61498765432',
		description: 'Numbers with country code, separated by commas or new lines (up to 1000)',
	},
	{
		displayName: 'Number',
		name: 'number',
		type: 'string',
		required: true,
		displayOptions: when('doNotCall', 'check'),
		default: '',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		displayOptions: when('doNotCall', 'remove'),
		default: '',
	},

	// ---- Contact opt-in
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('optIn'),
		options: [
			{ name: 'Add', value: 'add', action: 'Record an opt-in' },
			{ name: 'Remove', value: 'remove', action: 'Remove an opt-in record' },
		],
		default: 'add',
	},
	{
		displayName: 'Numbers',
		name: 'numbers',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		displayOptions: when('optIn', 'add'),
		default: '',
		placeholder: '61412345678, 61498765432',
		description: 'Numbers that opted in, separated by commas or new lines (up to 1000). All or nothing.',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		displayOptions: when('optIn', 'remove'),
		default: '',
	},

	// ---- Usage
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: when('usage'),
		options: [{ name: 'Get', value: 'get', action: 'Get usage and limits' }],
		default: 'get',
	},
];

export class App2email implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'app2email',
		name: 'app2email',
		icon: 'file:app2email.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Send and read WhatsApp messages, contacts, broadcasts and templates with app2email',
		defaults: {
			name: 'app2email',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'app2emailApi',
				required: true,
			},
		],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const result = await runOperation.call(this, i);
				const rows = Array.isArray(result) ? result : [result];
				for (const row of rows) {
					returnData.push({ json: row, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// The API answers errors as { success:false, error:{ code, message, how_to_fix } }.
				const apiError = (error as { response?: { body?: { error?: { message?: string; how_to_fix?: string } } } })
					.response?.body?.error;
				throw new NodeApiError(this.getNode(), error as JsonObject, {
					itemIndex: i,
					message: apiError?.message ?? (error as Error).message,
					description: apiError?.how_to_fix,
				});
			}
		}

		return [returnData];
	}
}
