import chalk from "chalk";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { Action } from "./constants.js";

const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

interface FileConfig {
	action?: Action;
	configVersion?: number;
	delay?: number;
	includeEpisodes?: boolean;
	outputDir?: string;
	rtorrentRpcUrl?: string;
	includeNonVideos?: boolean;
	fuzzySizeThreshold?: number;
	excludeOlder?: string;
	excludeRecentSearch?: string;
	dataDirs?: string[];
	dataMode?: string;
	hardlinkDir?: string;
	torrentDir?: string;
	torznab?: string[];
	qbittorrentUrl?: string;
	duplicateCategories?: boolean;
	notificationWebhookUrl?: string;
	port?: number;
	searchCadence?: string;
	rssCadence?: string;
}

interface GenerateConfigParams {
	force?: boolean;
	docker?: boolean;
}

export function appDir(): string {
	return (
		process.env.CONFIG_DIR ||
		(process.platform === "win32"
			? path.resolve(process.env.LOCALAPPDATA, packageDotJson.name)
			: path.resolve(process.env.HOME, `.${packageDotJson.name}`))
	);
}

export function createAppDir(): void {
	mkdirSync(path.join(appDir(), "torrent_cache"), { recursive: true });
	mkdirSync(path.join(appDir(), "logs"), { recursive: true });
}

export function generateConfig({
	force = false,
	docker = false,
}: GenerateConfigParams): void {
	createAppDir();
	const dest = path.join(appDir(), "config.js");
	const templatePath = path.join(
		`./config.template${docker ? ".docker" : ""}.cjs`
	);
	if (!force && existsSync(dest)) {
		console.log("Configuration file already exists.");
		return;
	}
	copyFileSync(new URL(templatePath, import.meta.url), dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
}

export async function getFileConfig(): Promise<FileConfig> {
	if (process.env.DOCKER_ENV === "true") {
		generateConfig({ docker: true });
	}

	const configPath = path.join(appDir(), "config.js");

	try {
		return (await import(pathToFileURL(configPath).toString())).default;
	} catch (e) {
		if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
		return {};
	}
}
