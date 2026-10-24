import { getDefaultRuntimeConfig, stripDefaults } from "./configuration.js";
import { RUNTIME_CONFIG_SCHEMA } from "./configSchema.js";
import type { RuntimeConfig } from "./runtimeConfig.js";
import type { SettingsPersistence } from "./settingsPersistence.js";

export interface SettingsService {
	read(effective?: boolean): Promise<Record<string, unknown>>;
	patch(changes: unknown): Promise<void>;
	unset(key: string): Promise<void>;
	replace(settings: unknown): Promise<void>;
}

function requireSettingsObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Settings must be a JSON object.");
	}
	return value as Record<string, unknown>;
}

function parseStoredSettings(
	raw: string | null | undefined,
): Record<string, unknown> {
	if (raw == null)
		throw new Error(
			"No v7 settings found. Start cross-seed once to initialize or migrate your configuration.",
		);
	return requireSettingsObject(JSON.parse(raw));
}

export function checkSettingKey(key: string): void {
	if (!Object.hasOwn(RUNTIME_CONFIG_SCHEMA.shape, key))
		throw new Error(`Unknown setting: ${key}`);
}

const indexerAdvice =
	"Manage indexers in Settings → Trackers; changing legacy torznab does not update the indexer table. Use db backup to preserve indexers.";

/** One semantic API for daemon writes and offline recovery. No startup effects. */
export function createSettingsService(
	persistence: SettingsPersistence,
	options: {
		afterWrite?: (effective: RuntimeConfig) => void | Promise<void>;
	} = {},
): SettingsService {
	// Serialize application callbacks with writes as well as SQLite transactions.
	// A late callback must not restore an earlier in-memory configuration.
	let pending: Promise<void> = Promise.resolve();
	function mutate(
		edit: (stored: Record<string, unknown>) => unknown,
		replace = false,
	): Promise<void> {
		const result = pending.then(async () => {
			const effective = await persistence.transaction(
				async (transaction) => {
					const stored = replace
						? {}
						: parseStoredSettings(await transaction.read());
					const validated = RUNTIME_CONFIG_SCHEMA.strict().parse({
						...getDefaultRuntimeConfig(),
						...requireSettingsObject(edit(stored)),
					});
					await transaction.write(
						JSON.stringify(stripDefaults(validated)),
					);
					return validated;
				},
			);
			await options.afterWrite?.(effective);
		});
		pending = result.catch(() => undefined);
		return result;
	}
	const service: SettingsService = {
		async read(effective = false) {
			const overrides = parseStoredSettings(await persistence.read());
			// Raw reads intentionally tolerate invalid values so users can inspect and
			// repair settings that prevent startup. Mutations validate the final state.
			return effective
				? { ...getDefaultRuntimeConfig(), ...overrides }
				: overrides;
		},
		async patch(input) {
			const patch = requireSettingsObject(input);
			for (const key of Object.keys(patch)) checkSettingKey(key);
			if (Object.hasOwn(patch, "torznab")) throw new Error(indexerAdvice);
			const defined = Object.fromEntries(
				Object.entries(patch).filter(
					([, value]) => value !== undefined,
				),
			);
			await mutate((stored) => ({ ...stored, ...defined }));
		},
		async unset(key) {
			await mutate((stored) => {
				// Unknown persisted keys can be removed to recover after config mistakes.
				if (!Object.hasOwn(stored, key)) checkSettingKey(key);
				delete stored[key];
				return stored;
			});
		},
		async replace(input) {
			const replacement = requireSettingsObject(input);
			if (
				Array.isArray(replacement.torznab) &&
				replacement.torznab.length > 0
			) {
				throw new Error(
					"Legacy torznab URLs cannot be imported as settings. Configure indexers in Settings → Trackers, then remove torznab from this JSON. Use db backup to preserve indexers.",
				);
			}
			// Do not parse existing JSON: replacement is the escape hatch for malformed
			// persisted settings, and never invokes legacy config/indexer migration.
			await mutate(() => replacement, true);
		},
	};
	return service;
}
