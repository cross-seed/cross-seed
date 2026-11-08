import type { RuntimeConfig } from "./runtimeConfig.js";
import { CrossSeedError } from "./errors.js";

/** Configuration failures are recoverable; database and listener failures aren't. */
export class ConfigurationError extends CrossSeedError {
	constructor(
		message: string,
		readonly source: "database" | "file",
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

export type DaemonRecovery = {
	message: string;
	source: "database" | "file";
	useJsonEditor: boolean;
};
let recovery: DaemonRecovery | null = null;
let resume: ((config: RuntimeConfig) => Promise<void>) | undefined;

export function getDaemonRecovery(): DaemonRecovery | null {
	return recovery;
}
export function setDaemonRecovery(state: DaemonRecovery | null): void {
	recovery = state;
}
export function registerRecoveryResume(
	handler: (config: RuntimeConfig) => Promise<void>,
): void {
	resume = handler;
}
/** A recovery save must initialize the runtime before any work can start. */
export async function resumeRecoveredDaemon(
	config: RuntimeConfig,
): Promise<boolean> {
	if (!recovery) return false;
	if (!resume) throw new Error("Daemon recovery is not initialized.");
	await resume(config);
	return true;
}
export const RECOVERY_MESSAGE =
	"Cross-seed is paused because its settings are invalid. Open Settings to repair them.";
