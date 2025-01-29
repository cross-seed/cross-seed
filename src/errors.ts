import { logger } from "./logger.js";

export class CrossSeedError extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message, options);
		delete this.stack;
	}

	print(): void {
		if (logger) {
			logger.error(this.message);

			if (this.cause) {
				logger.debug(this.cause);
			}
		} else {
			console.error(this);
		}
	}
}

export function exitOnCrossSeedErrors(e) {
	if (e instanceof CrossSeedError) {
		e.print();
		process.exitCode = 1;
		return;
	}
	throw e;
}
