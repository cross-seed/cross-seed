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
