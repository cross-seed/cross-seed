import { z } from "zod";
import { BlocklistType } from "./constants.js";

const blocklistTypeSchema = z.nativeEnum(BlocklistType);

export const blocklistEntrySchema = z
	.string()
	.superRefine((entry, ctx) => {
		const match = entry.match(/^(?<type>.+?):(?<value>.*)$/);
		const parsedType = blocklistTypeSchema.safeParse(
			match?.groups?.type ?? BlocklistType.LEGACY,
		);
		const value = match?.groups?.value ?? entry;
		const fail = (message: string) =>
			ctx.addIssue({ code: "custom", message });
		if (!parsedType.success) {
			fail(
				`Unknown blocklist prefix. Use ${Object.values(BlocklistType).join(", ")}.`,
			);
			return;
		}
		const type = parsedType.data;
		// Empty category/tag values deliberately select uncategorized/untagged torrents.
		if (
			!value.trim() &&
			type !== BlocklistType.CATEGORY &&
			type !== BlocklistType.TAG
		) {
			fail("Blocklist entry must have a value.");
			return;
		}
		if (
			type === BlocklistType.NAME_REGEX ||
			type === BlocklistType.FOLDER_REGEX
		) {
			try {
				new RegExp(value);
			} catch {
				fail("Blocklist regular expression is invalid.");
			}
		}
		if (type === BlocklistType.INFOHASH && !/^[a-z0-9]{40}$/i.test(value)) {
			fail(
				"Blocklist info hash must contain 40 alphanumeric characters.",
			);
		}
	})
	// overwrite preserves the string schema for generated CLI help/flags.
	.overwrite((entry) =>
		entry.startsWith(`${BlocklistType.INFOHASH}:`)
			? `${BlocklistType.INFOHASH}:${entry.slice(BlocklistType.INFOHASH.length + 1).toLowerCase()}`
			: entry,
	);

export const torrentClientEntrySchema = z.string().superRefine((entry, ctx) => {
	const match = entry.match(
		/^(?<type>qbittorrent|rtorrent|transmission|deluge):(?:readonly:)?(?<url>.*)$/,
	);
	const fail = (message: string) => ctx.addIssue({ code: "custom", message });
	if (!match?.groups) {
		fail(
			"Expected a qbittorrent:, rtorrent:, transmission:, or deluge: client prefix, optionally followed by readonly:.",
		);
		return;
	}
	try {
		const url = new URL(match.groups.url);
		if (url.protocol === "http:" || url.protocol === "https:") return;
		if (match.groups.type === "rtorrent" && url.protocol === "scgi:") {
			if (url.host) {
				const port = Number(url.port);
				if (Number.isInteger(port) && port >= 1 && port <= 65535)
					return;
				fail("SCGI network endpoints require a port from 1 to 65535.");
			} else {
				const socket = decodeURIComponent(url.pathname);
				if (socket.startsWith("/") && socket.length > 1) return;
				fail("SCGI Unix endpoints require an absolute socket path.");
			}
			return;
		}
		fail("Torrent clients require HTTP(S), or SCGI for rTorrent.");
	} catch {
		// Do not echo a connection string: it can contain a username/password.
		fail("Torrent client URL is invalid.");
	}
});
