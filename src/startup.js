const { validateJackettApi } = require("./jackett");
const { validateRtorrentApi } = require("./clients/rtorrent");
const logger = require("./logger");

exports.doStartupValidation = async function doStartupValidation() {
	logger.log("Validating your configuration...");
	await Promise.all([validateJackettApi(), validateRtorrentApi()]);
	logger.log("Your configuration is valid!");
};
