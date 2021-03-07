import * as logger from "./logger";

export class CrossSeedError extends Error {
	constructor(message) {
		super(message);
		delete this.stack;
	}

	print() {
		logger.error(this.message);
	}
}
