module.exports = {
	parser: "@typescript-eslint/parser",
	env: {
		node: true,
		commonjs: true,
		es2021: true,
	},
	plugins: ["@typescript-eslint"],
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
	],
	parserOptions: {
		ecmaVersion: 2022,
		project: "./packages/cross-seed/tsconfig.eslint.json",
		// Ensure the path resolves from the repo root regardless of CWD.
		tsconfigRootDir: __dirname,
	},
	ignorePatterns: [
		"packages/api-types/**",
		"packages/shared/**",
		"packages/webui/**",
		"scripts/**",
	],
	rules: {
		"no-mixed-spaces-and-tabs": "off",
		"@typescript-eslint/no-var-requires": "off",
		"@typescript-eslint/no-unnecessary-type-assertion": "error",
		"@typescript-eslint/return-await": "error",
		"@typescript-eslint/await-thenable": "error",
		"@typescript-eslint/no-floating-promises": "error",
		"@typescript-eslint/no-misused-promises": [
			"error",
			{
				checksVoidReturn: {
					arguments: false,
				},
			},
		],
	},
};
