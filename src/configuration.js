const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
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

function generateConfig({ force = false, docker = false }) {
	createAppDir();
	const dest = path.join(appDir(), "config.js");
	const templatePath = path.join(
		__dirname,
		`config.template${docker ? ".docker" : ""}.js`
	);
	if (!force && fs.existsSync(dest)) {
		console.error("Configuration file already exists.");
		process.exitCode = 17; // EEXIST
		return;
	}
	fs.copyFileSync(templatePath, dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
}

try {
	CONFIG = require(path.join(appDir(), "config.js"));
} catch (_) {
	// swallow error
}

module.exports = { CONFIG, appDir, createAppDir, generateConfig };
