const logger = require("./logger");

exports.CrossSeedError = class CrossSeedError extends Error {
	constructor(message) {
		super(message);
		delete this.stack;
	}

	print() {
		logger.error(this.message);
	}
};
