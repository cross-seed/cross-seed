const { getRuntimeConfig } = require("./runtimeConfig");

exports.log = function log(...args) {
	console.log(...args);
};

exports.verbose = function verbose(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.log(...args);
	}
};

exports.error = function error(...args) {
	console.error(...args);
};

exports.warn = function warn(...args) {
	console.warn(...args);
};
