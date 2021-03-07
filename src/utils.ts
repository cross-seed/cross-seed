import { EXTENSIONS } from "./constants";

export function stripExtension(filename) {
	for (const ext of EXTENSIONS) {
		const re = new RegExp(`\\.${ext}$`);
		if (re.test(filename)) return filename.replace(re, "");
	}
	return filename;
}

export const partial = (func, ...presets) => (...args) => {
	func(...presets, ...args);
};

export function nMinutesAgo(n) {
	const date = new Date();
	date.setMinutes(date.getMinutes() - n);
	return date.getTime();
}

export function wait(n) {
	return new Promise((resolve) => setTimeout(resolve, n));
}
