const { EXTENSIONS } = require("./constants");

function stripExtension(filename) {
	for (const ext of EXTENSIONS) {
		const re = new RegExp(`\\.${ext}$`);
		if (re.test(filename)) return filename.replace(re, "");
	}
	return filename;
}

module.exports = { stripExtension };
