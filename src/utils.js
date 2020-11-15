const { EXTENSIONS } = require("./constants");

function stripExtension(filename) {
	for (const ext of EXTENSIONS) {
		const re = new RegExp(`\\.${ext}$`);
		if (re.test(filename)) return filename.replace(re, "");
	}
	return filename;
}

const partial = (func, ...presets) => (...args) => {
	func(...presets, ...args);
};

function nMinutesAgo(n) {
	const date = new Date();
	date.setMinutes(date.getMinutes() - n);
	return date.getTime();
}

module.exports = { stripExtension, partial, nMinutesAgo };
