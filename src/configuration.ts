import { CONFIG_TEMPLATE_URL } from "./constants";
import packageDotJson from "../package.json";
import * as logger from "./logger";
import configTemplate from "./config.template";
import chalk from "chalk";
import path from "path";
import fs from "fs";

export function appDir() {
	return (
		process.env.CONFIG_DIR ||
		(process.platform === "win32"
			? path.resolve(process.env.LOCALAPPDATA, packageDotJson.name)
			: path.resolve(process.env.HOME, `.${packageDotJson.name}`))
	);
}

export function createAppDir() {
	return fs.mkdirSync(appDir(), { recursive: true });
}

export function generateConfig({ force = false, docker = false }) {
	createAppDir();
	const dest = path.join(appDir(), "config.js");
	const templatePath = path.join(
		__dirname,
		`config.template${docker ? ".docker" : ""}.js`
	);
	if (!force && fs.existsSync(dest)) {
		logger.log("Configuration file already exists.");
		return;
	}
	fs.copyFileSync(templatePath, dest);
	logger.log("Configuration file created at", chalk.yellow.bold(dest));
}

function printUpdateInstructions(missingKeys) {
	const configPath = path.join(appDir(), "config.js");
	console.error(chalk.yellow`
 Error: Your configuration file is out of date.
 Missing options:\n\t${missingKeys.join("\n\t")}
 Please update at ${configPath}.
 When you are done, set the configVersion to ${configTemplate.configVersion}.
 It may help to read the template, at ${CONFIG_TEMPLATE_URL}
 `);
}

export function getFileConfig() {
	const configPath = path.join(appDir(), "config.js");
	if (!fs.existsSync(configPath)) return {};

	const fileConfig = require(configPath);
	const { configVersion = 0 } = fileConfig;
	if (configVersion < configVersion) {
		const missingKeys = Object.keys(configTemplate).filter(
			(k) => !(k in fileConfig)
		);
		printUpdateInstructions(missingKeys);
	}
	return fileConfig;
}
