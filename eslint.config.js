import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"coverage/**",
			"dist/**",
			"node_modules/**",
			"packages/api-types/**",
			"packages/mock-torznab/**",
			"packages/shared/**",
			"packages/webui/**",
			"sea/**",
		],
	},
	js.configs.recommended,
	{
		files: ["packages/cross-seed/{src,tests}/**/*.ts"],
		extends: [...tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.node,
			parserOptions: {
				project: "./packages/cross-seed/tsconfig.eslint.json",
				tsconfigRootDir: import.meta.dirname,
			},
			sourceType: "module",
		},
		rules: {
			"no-mixed-spaces-and-tabs": "off",
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
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/no-var-requires": "off",
			"@typescript-eslint/return-await": "error",
		},
	},
	{
		files: ["scripts/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.node,
			sourceType: "module",
		},
	},
);
