import { logger } from "./logger";

export class CrossSeedError extends Error {
	constructor(message: string) {
		super(message);
		delete this.stack;
	}

	print(): void {
		logger.error(this.message);
	}
}
