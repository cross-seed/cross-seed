export function omitUndefined<T extends Record<string, unknown>>(
	obj: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}
