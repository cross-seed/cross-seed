/** Stop accepting work and drain it before shared resources are destroyed. */
const hooks = new Set<() => Promise<void>>();

export function registerShutdownHook(hook: () => Promise<void>): () => void {
	hooks.add(hook);
	return () => {
		hooks.delete(hook);
	};
}

export async function drainShutdownHooks(): Promise<void> {
	await Promise.all([...hooks].map((hook) => hook()));
}
