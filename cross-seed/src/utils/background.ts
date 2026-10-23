/**
 * Detach work that must not block its caller (for example, resume polling).
 * Expected failures belong in the task itself. An unexpected rejection remains
 * fatal: throw outside the promise chain rather than creating another rejected
 * promise or silently swallowing the error.
 */
export function runInBackground(task: Promise<unknown>): void {
	task.catch((error: unknown) => {
		queueMicrotask(() => {
			throw error;
		});
	});
}
