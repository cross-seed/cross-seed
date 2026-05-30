import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Root config for editor integration and scripts only.
// Each package owns its own eslint.config.js and lint script.
export default tseslint.config(
	{
		ignores: [
			"coverage/**",
			"dist/**",
			"node_modules/**",
			"cross-seed/**",
			"shared/**",
			"webui/**",
			"api-types/**",
			"sea/**",
		],
	},
	js.configs.recommended,
	{
		files: ["scripts/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.node,
			sourceType: "module",
		},
	},
);
