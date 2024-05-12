class OkResult<T> {
	private readonly contents: T;

	constructor(contents: T) {
		this.contents = contents;
	}

	isOk(): this is OkResult<T> {
		return true;
	}

	isErr(): false {
		return false;
	}

	mapOk<R>(mapper: (t: T) => R): OkResult<R> {
		return new OkResult(mapper(this.contents));
	}

	mapErr(): OkResult<T> {
		return this;
	}

	unwrap(): T {
		return this.contents;
	}

	unwrapOrThrow(): T {
		return this.contents;
	}

	orElse(): T {
		return this.contents;
	}

	toArray(): [T] {
		return [this.contents];
	}
}

class ErrResult<U> {
	private readonly contents: U;

	constructor(contents: U) {
		this.contents = contents;
	}

	isOk(): this is OkResult<never> {
		return false;
	}

	isErr(): this is ErrResult<U> {
		return true;
	}

	mapOk(): ErrResult<U> {
		return this;
	}

	mapErr<R>(mapper: (u: U) => R): ErrResult<R> {
		return new ErrResult(mapper(this.contents));
	}

	unwrapErr(): U {
		return this.contents;
	}

	unwrapOrThrow(errToThrow: Error): never {
		throw errToThrow;
	}

	orElse<T>(t: T): T {
		return t;
	}

	toArray(): [] {
		return [];
	}
}

export type Result<T, U> = OkResult<T> | ErrResult<U>;

export function resultOf<T, U>(value: T): Result<T, U> {
	return new OkResult(value);
}

export function resultOfErr<T, U>(value: U): Result<T, U> {
	return new ErrResult(value);
}
