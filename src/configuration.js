const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const packageDotJson = require("../package.json");

let runtimeConfig = {
	jackettServerUrl: undefined,
	jackettApiKey: undefined,
	delay: undefined,
	trackers: undefined,
	torrentDir: undefined,
	outputDir: undefined,
	includeEpisodes: undefined,
	verbose: undefined,
};

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
		console.log("Configuration file already exists.");
		return;
	}
	fs.copyFileSync(templatePath, dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
}

function getFileConfig() {
	const path = path.join(appDir(), "config.js");
	let fileConfig = {};
	if (fs.existsSync(path)) {
		fileConfig = require(path);
	}
	return fileConfig;
}

function setRuntimeConfig(configObj) {
	runtimeConfig = configObj;
}

function getRuntimeConfig() {
	return runtimeConfig;
}

module.exports = {
	appDir,
	createAppDir,
	generateConfig,
	getFileConfig,
	setRuntimeConfig,
	getRuntimeConfig,
};
