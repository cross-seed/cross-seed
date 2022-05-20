import { logger } from "./logger.js";

export class CrossSeedError extends Error {
	constructor(message: string) {
		super(message);
		delete this.stack;
	}

	print(): void {
		logger.error(this.message);
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
