export interface Result<T, U> {
	isOk(): boolean;
	isErr(): boolean;
	mapOk<R>(mapper: (t: T) => R): Result<R, U>;
	mapErr<R>(mapper: (u: U) => R): Result<T, R>;
	unwrapOrThrow(errToThrow?: Error): T;
	unwrapErrOrThrow(): U;
}

class OkResult<T, U> implements Result<T, U> {
	private readonly contents: T;

	constructor(contents: T) {
		this.contents = contents;
	}

	isOk() {
		return true;
	}

	isErr() {
		return false;
	}

	mapOk<R>(mapper: (t: T) => R): Result<R, U> {
		return new OkResult(mapper(this.contents));
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	mapErr<R>(mapper: (u: U) => R): Result<T, R> {
		return this as unknown as Result<T, R>;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	unwrapOrThrow(errToThrow?: Error): T {
		return this.contents;
	}

	unwrapErrOrThrow(): U {
		throw new Error("Tried to unwrap an OkResult's error");
	}
}

class ErrResult<T, U> implements Result<T, U> {
	private readonly contents: U;

	constructor(contents: U) {
		this.contents = contents;
	}

	isOk(): boolean {
		return false;
	}

	isErr(): boolean {
		return true;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	mapOk<R>(mapper: (t: T) => R): Result<R, U> {
		return this as unknown as Result<R, U>;
	}

	mapErr<R>(mapper: (u: U) => R): Result<T, R> {
		return new ErrResult(mapper(this.contents));
	}

	unwrapOrThrow(errToThrow?: Error): T {
		throw errToThrow ?? new Error("Tried to unwrap an ErrResult's error");
	}

	unwrapErrOrThrow(): U {
		return this.contents;
	}
}

export function resultOf<T, U>(value: T): Result<T, U> {
	return new OkResult(value);
}

export function resultOfErr<T, U>(value: U): Result<T, U> {
	return new ErrResult(value);
}
