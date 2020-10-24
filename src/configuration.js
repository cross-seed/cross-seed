const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const packageDotJson = require("../package.json");
const logger = require("./logger");

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
		logger.log("Configuration file already exists.");
		return;
	}
	fs.copyFileSync(templatePath, dest);
	logger.log("Configuration file created at", chalk.yellow.bold(dest));
}

function getFileConfig() {
	const configPath = path.join(appDir(), "config.js");
	let fileConfig = {};
	if (fs.existsSync(configPath)) {
		fileConfig = require(configPath);
	}
	return fileConfig;
}

module.exports = {
	appDir,
	createAppDir,
	generateConfig,
	getFileConfig,
};
