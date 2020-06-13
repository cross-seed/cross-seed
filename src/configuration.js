const fs = require("fs");
const path = require("path");
const chalk = require('chalk');
const packageDotJson = require("../package.json");

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

function generateConfig() {
	createAppDir();
	const dest = path.join(appDir(), "config.js");
	fs.copyFileSync(path.join(__dirname, "config.template.js"), dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
	return dest;
}

try {
	CONFIG = require(path.join(appDir(), "config.js"));
} catch (_) {}

module.exports = { CONFIG, appDir, createAppDir, generateConfig };
