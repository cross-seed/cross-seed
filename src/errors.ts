export class CrossSeedError extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message, options);
		delete this.stack;
	}
}
