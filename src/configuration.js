const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const packageDotJson = require("../package.json");
const configTemplate = require("./config.template");
const { CONFIG_TEMPLATE_URL } = require("./constants");

let CONFIG = {};

function appDir() {
	return (
		process.env.CONFIG_DIR ||
		(process.platform === "win32"
			? path.resolve(process.env.LOCALAPPDATA, packageDotJson.name)
			: path.resolve(process.env.HOME, `.${packageDotJson.name}`))
	);
}

function createAppDir() {
	return fs.mkdirSync(appDir(), { recursive: true });
}

function generateConfig(force = false) {
	createAppDir();
	const dest = path.join(appDir(), "config.js");
	const configPath = path.join(__dirname, "config.template.js");
	if (!force && fs.existsSync(configPath)) {
		console.error("Configuration file already exists.");
		process.exitCode = 17; // EEXIST
		return dest;
	}
	fs.copyFileSync(configPath, dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
	return dest;
}

function printUpdateInstructions(missingKeys) {
	const configPath = path.join(appDir(), "config.js");
	console.error(chalk.red`
Error: Your configuration file is out of date.
Missing: ${missingKeys.join(", ")}
Please update at ${configPath}.
When you are done, set the configVersion to ${configTemplate.configVersion}.
It may help to read the template, at ${CONFIG_TEMPLATE_URL}
`);
}

try {
	const configPath = path.join(appDir(), "config.js");
	CONFIG = require(configPath);
	const { configVersion = 0 } = CONFIG;
	if (configVersion < configTemplate.configVersion) {
		const missingKeys = Object.keys(configTemplate).filter(
			(k) => !CONFIG.includes(k)
		);
		printUpdateInstructions(missingKeys);
		process.exitCode = 1;
	}
} catch (_) {}

module.exports = { CONFIG, appDir, createAppDir, generateConfig };
