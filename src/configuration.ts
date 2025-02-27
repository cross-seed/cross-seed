import chalk from "chalk";
import {
	accessSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	writeFileSync,
} from "fs";
import { createRequire } from "module";
import path from "path";
import { Action, MatchMode, PROGRAM_NAME } from "./constants.js";
import { CrossSeedError } from "./errors.js";
import { isSea, getAsset } from "node:sea";

export interface FileConfig {
	action?: Action;
	pconfigVersion?: number;
	delay?: number;
	includeSingleEpisodes?: boolean;
	outputDir?: string;
	rtorrentRpcUrl?: string;
	includeNonVideos?: boolean;
	seasonFromEpisodes?: number;
	fuzzySizeThreshold?: number;
	excludeOlder?: string;
	excludeRecentSearch?: string;
	useClientTorrents?: boolean;
	dataDirs?: string[];
	matchMode?: MatchMode;
	skipRecheck?: boolean;
	autoResumeMaxDownload?: number;
	linkDir?: string;
	linkDirs?: string[];
	linkType?: string;
	flatLinking?: boolean;
	maxDataDepth?: number;
	linkCategory?: string;
	torrentDir?: string;
	torznab?: string[];
	qbittorrentUrl?: string;
	transmissionRpcUrl?: string;
	delugeRpcUrl?: string;
	duplicateCategories?: boolean;
	notificationWebhookUrls?: string[];
	notificationWebhookUrl?: string;
	port?: number;
	host?: string;
	searchCadence?: string;
	rssCadence?: string;
	snatchTimeout?: string;
	searchTimeout?: string;
	searchLimit?: number;
	blockList?: string[];
	apiKey?: string;
	sonarr?: string[];
	radarr?: string[];
}

export const UNPARSABLE_CONFIG_MESSAGE = `
Your config file is improperly formatted. The location of the error is above, \
but you may have to look backwards to see the root cause.
Make sure that
  - strings (words, URLs, etc) are wrapped in "quotation marks"
  - any arrays (lists of things, even one thing) are wrapped in [square brackets]
  - every entry has a comma after it, including inside arrays
`.trim();

/**
 * Returns the appDir relevant to the OS/Environment. Due to initialization of
 * the SQLiteDB during read of db.ts - will need to create appDir in this function if
 * it does not exist (ENOENT)
 *
 * @return a string representing the absolute path to cross-seed config directory
 */
export function appDir(): string {
	const appDir =
		process.env.CONFIG_DIR ||
		(process.platform === "win32"
			? path.resolve(process.env.LOCALAPPDATA!, PROGRAM_NAME)
			: path.resolve(process.env.HOME!, `.${PROGRAM_NAME}`));
	try {
		accessSync(appDir, constants.R_OK | constants.W_OK);
	} catch (e) {
		if (e.code === "ENOENT") {
			mkdirSync(appDir, { recursive: true });
			return appDir;
		}
		const dockerMessage =
			process.env.DOCKER_ENV === "true"
				? ` Use chown to set the owner to ${process.getuid!()}:${process.getgid!()}`
				: "";
		throw new CrossSeedError(
			`cross-seed does not have R/W permissions on your config directory.${dockerMessage}`,
		);
	}
	return appDir;
}

export function createAppDirHierarchy(): void {
	const appDirPath = appDir();
	mkdirSync(path.join(appDirPath, "torrent_cache"), { recursive: true });
	mkdirSync(path.join(appDirPath, "logs"), { recursive: true });
}

export function generateConfig(): void {
	createAppDirHierarchy();
	const dest = path.join(appDir(), "config.js");
	const templatePath = "config.template.cjs";
	if (existsSync(dest)) {
		console.log("Configuration file already exists.");
		return;
	}

	if (isSea()) {
		writeFileSync(dest, getAsset(templatePath, "utf8"));
	} else {
		copyFileSync(new URL(templatePath, import.meta.url), dest);
	}

	console.log("Configuration file created at", chalk.yellow.bold(dest));
}

export function getFileConfig(): FileConfig {
	if (process.env.DOCKER_ENV === "true") {
		generateConfig();
	}

	// cwd is not special, it's just a stand in.
	// We only pass an absolute path to require so it doesn't matter.
	const require = createRequire(process.cwd());
	try {
		return require(path.join(appDir(), "config.js"));
	} catch (e) {
		if (
			e.code === "ERR_MODULE_NOT_FOUND" ||
			e.code === "MODULE_NOT_FOUND"
		) {
			return {};
		} else if (e instanceof SyntaxError) {
			const location = e.stack!.split("\n").slice(0, 3).join("\n");
			throw new CrossSeedError(
				`\n${chalk.red(location)}\n\n${UNPARSABLE_CONFIG_MESSAGE}`,
			);
		} else {
			throw e;
		}
	}
}
