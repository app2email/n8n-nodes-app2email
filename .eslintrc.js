// n8n's community node lint rules (required for Creator Portal verification): https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: { project: ['./tsconfig.json'], sourceType: 'module', extraFileExtensions: ['.json'] },
	ignorePatterns: ['dist/**', 'node_modules/**', '**/*.js'],
	overrides: [
		{ files: ['package.json'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/community'] },
		{ files: ['./credentials/**/*.ts'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/credentials'] },
		{ files: ['./nodes/**/*.ts'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/nodes'] },
	],
};
