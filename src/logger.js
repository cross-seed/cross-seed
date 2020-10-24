const { getRuntimeConfig } = require("./runtimeConfig");

function log(...args) {
	console.log(...args);
}

function verbose(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.log(...args);
	}
}

function error(...args) {
	console.error(...args);
}

function warn(...args) {
	console.warn(...args);
}

module.exports = { log, verbose, error, warn };
