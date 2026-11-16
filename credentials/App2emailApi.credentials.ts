import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class App2emailApi implements ICredentialType {
	name = 'app2emailApi';

	displayName = 'app2email API';

	documentationUrl = 'https://www.app2email.com/dashboard/apikey';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Starts with a2e_. Create one at app2email dashboard, API key page.',
		},
		{
			displayName: 'WhatsApp Number',
			name: 'number',
			type: 'string',
			default: '',
			required: true,
			placeholder: '4976659348270',
			description:
				'The WhatsApp number messages are sent from. Digits only, with the country code.',
		},
	];

	// Every call sends the key in the X-API-KEY header.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-KEY': '={{$credentials.apiKey}}',
			},
		},
	};

	// "Test connection" in the credential dialog: GET /v1/{number}/me
	test: ICredentialTestRequest = {
		request: {
			baseURL: '=https://api.app2email.com/v1/{{$credentials.number}}',
			url: '/me',
		},
	};
}
