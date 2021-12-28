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
