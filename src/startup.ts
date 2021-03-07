import { validateJackettApi } from "./jackett";
import { validateRtorrentApi } from "./clients/rtorrent";
import * as logger from "./logger";

export async function doStartupValidation() {
	logger.log("Validating your configuration...");
	await Promise.all([validateJackettApi(), validateRtorrentApi()]);
	logger.log("Your configuration is valid!");
}
