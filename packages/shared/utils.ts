export function formatAsList(
	strings: string[],
	options: {
		sort: boolean;
		style?: Intl.ListFormatStyle;
		type?: Intl.ListFormatType;
	},
) {
	if (options.sort) strings.sort((a, b) => a.localeCompare(b));
	return new Intl.ListFormat("en", {
		style: options.style ?? "long",
		type: options.type ?? "conjunction",
	}).format(strings);
}

export function formatBytes(
	bytes: number | null | undefined,
	options?: { binary?: boolean },
) {
	if (bytes === null || bytes === undefined) return "Unknown";
	if (bytes === 0) return "0 B";
	const k = options?.binary ? 1024 : 1000;
	const sizes = options?.binary
		? ["B", "KiB", "MiB", "GiB", "TiB"]
		: ["B", "kB", "MB", "GB", "TB"];
	const exponent = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
	const coefficient = bytes / Math.pow(k, exponent);
	return `${parseFloat(coefficient.toFixed(2))} ${sizes[exponent]}`;
}
