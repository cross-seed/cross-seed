import type { Problem } from "../problems.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { db } from "../db.js";

export async function collectSearcheeProblems(): Promise<Problem[]> {
	const { useClientTorrents, torrentDir, dataDirs } = getRuntimeConfig();
	const expectsSearchees =
		Boolean(useClientTorrents) ||
		Boolean(torrentDir) ||
		(Array.isArray(dataDirs) && dataDirs.length > 0);

	if (!expectsSearchees) {
		return [];
	}

	const [{ count }] = await db("searchee").count<{ count: string }>({
		count: "*",
	});
	const total = Number(count ?? 0);

	if (total > 0) {
		return [];
	}

	return [
		{
			id: "searchees:none-indexed",
			severity: "warning",
			summary: "No searchees have been indexed yet.",
			details:
				"cross-seed has not indexed any torrents. Check that the indexing job succeeds and that torrentDir, useClientTorrents, or dataDirs are configured correctly.",
			metadata: {
				useClientTorrents,
				torrentDir: torrentDir ?? null,
				dataDirsCount: dataDirs?.length ?? 0,
			},
		},
	];
}
