const { getRuntimeConfig } = require("./runtimeConfig");
const chalk = require("chalk");

exports.log = function log(...args) {
	console.log(...args);
};

exports.verbose = function verbose(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.log(...args);
	}
};

exports.debug = function debug(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.error(...args);
	}
};

exports.error = function error(...args) {
	console.error(...args.map((arg) => chalk.red(arg)));
};

exports.warn = function warn(...args) {
	console.warn(...args.map((arg) => chalk.yellow(arg)));
};
