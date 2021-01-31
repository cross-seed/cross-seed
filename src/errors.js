exports.CrossSeedError = class CrossSeedError extends Error {
	constructor(message) {
		super(message);
		delete this.stack;
		process.exitCode = 1;
	}
};
