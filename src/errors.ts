import { logger } from "./logger.js";

export class CrossSeedError extends Error {
	print(): void {
		logger.error(this.message);
		if (this.cause) {
			logger.debug(this.cause);
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
