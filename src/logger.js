const { getRuntimeConfig } = require("./configuration");

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

const withPresetArgs = (loggerFn, ...presets) => (...args) => {
	loggerFn(...presets, ...args);
};

module.exports = { log, verbose, error, warn, withPresetArgs };
