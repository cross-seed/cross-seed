import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcCliMeta } from "trpc-cli";
import { z } from "zod";
import { RUNTIME_CONFIG_SCHEMA } from "./configSchema.js";
import type { SettingsService } from "./settingsService.js";

// The same schemas and procedures run in HTTP and CLI contexts. The context
// supplies either the local application service or a typed remote adapter.
const t = initTRPC
	.context<{ settingsService?: SettingsService }>()
	.meta<TrpcCliMeta>()
	.create();
const procedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.settingsService) throw new TRPCError({ code: "UNAUTHORIZED" });
	return next({ ctx: { settingsService: ctx.settingsService } });
});
const key = RUNTIME_CONFIG_SCHEMA.keyof()
	.describe("Runtime setting name")
	.meta({ positional: true });
export const settingsApiRouter = t.router({
	show: procedure
		.meta({
			description: "Print stored settings as JSON, including secrets",
		})
		.input(
			z
				.object({
					effective: z
						.boolean()
						.optional()
						.describe("Include runtime defaults"),
				})
				.strict(),
		)
		.query(({ ctx, input }) => ctx.settingsService.read(input.effective)),
	get: procedure
		.meta({ description: "Print one effective setting as JSON" })
		.input(z.object({ key }).strict())
		.query(
			async ({ ctx, input }) =>
				(await ctx.settingsService.read(true))[input.key] ?? null,
		),
	set: procedure
		.meta({
			description: "Set runtime settings using typed flags or --json",
			negateBooleans: true,
		})
		.input(RUNTIME_CONFIG_SCHEMA.omit({ torznab: true }).partial().strict())
		.mutation(async ({ ctx, input }) => {
			await ctx.settingsService.patch(input);
			return { success: true };
		}),
	unset: procedure
		.meta({ description: "Remove an override and restore its default" })
		.input(
			z
				.object({
					key: z
						.string()
						.describe(
							"Setting to reset; obsolete stored keys can also be removed",
						)
						.meta({ positional: true }),
				})
				.strict(),
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.settingsService.unset(input.key);
			return { success: true };
		}),
	replace: procedure
		.meta({
			description:
				"Replace settings from JSON; leaves indexers, users and history untouched",
			jsonInput: "always",
		})
		.input(RUNTIME_CONFIG_SCHEMA.partial().strict())
		.mutation(async ({ ctx, input }) => {
			await ctx.settingsService.replace(input);
			return { success: true };
		}),
});
export type SettingsApiRouter = typeof settingsApiRouter;
