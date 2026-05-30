import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**", "coverage/**"],
	},
	js.configs.recommended,
	{
		files: ["{src,tests}/**/*.ts"],
		extends: [...tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.node,
			parserOptions: {
				project: "./tsconfig.eslint.json",
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
);
