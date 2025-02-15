import { logger } from "./logger.js";

export class CrossSeedError extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message, options);
		delete this.stack;
	}
}

export function exitOnCrossSeedErrors(e) {
	logger ? logger.error(e) : console.error(e);
	if (e instanceof CrossSeedError) {
		process.exitCode = 1;
		return;
	}
	throw e;
}
