import {
	EP_REGEX,
	EXTENSIONS,
	MOVIE_REGEX,
	SEASON_REGEX,
} from "./constants.js";

export function stripExtension(filename: string): string {
	for (const ext of EXTENSIONS) {
		const re = new RegExp(`\\.${ext}$`);
		if (re.test(filename)) return filename.replace(re, "");
	}
	return filename;
}

export function nMinutesAgo(n: number): number {
	const date = new Date();
	date.setMinutes(date.getMinutes() - n);
	return date.getTime();
}

export function wait(n: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, n));
}

export function getTag(name: string): string {
	return EP_REGEX.test(name)
		? "episode"
		: SEASON_REGEX.test(name)
		? "pack"
		: MOVIE_REGEX.test(name)
		? "movie"
		: "unknown";
}

export type Result<T> = T | Error;

export const ok = <T>(r: Result<T>): r is T => !(r instanceof Error);

export function reformatTitleForSearching(name: string): string {
	const seasonMatch = name.match(SEASON_REGEX);
	const movieMatch = name.match(MOVIE_REGEX);
	const episodeMatch = name.match(EP_REGEX);
	const fullMatch =
		episodeMatch?.[0] ?? seasonMatch?.[0] ?? movieMatch?.[0] ?? name;
	return fullMatch
		.replace(/[._()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
