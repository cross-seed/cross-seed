import chalk from "chalk";
import {
	accessSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "fs";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { generate } from "@babel/generator";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import {
	Action,
	LOGS_FOLDER,
	MatchMode,
	TORRENT_CACHE_FOLDER,
} from "./constants.js";
import { CrossSeedError } from "./errors.js";

const require = createRequire(import.meta.url);
const packageDotJson = require("../package.json");

export interface FileConfig {
	action?: Action;
	pconfigVersion?: number;
	delay?: number;
	includeSingleEpisodes?: boolean;
	outputDir?: string;
	injectDir?: string;
	ignoreTitles?: boolean;
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
	ignoreNonRelevantFilesToResume?: boolean;
	linkDir?: string;
	linkDirs?: string[];
	linkType?: string;
	flatLinking?: boolean;
	maxDataDepth?: number;
	linkCategory?: string;
	torrentDir?: string;
	torznab?: string[];
	torrentClients?: string[];
	qbittorrentUrl?: string;
	rtorrentRpcUrl?: string;
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
			? path.resolve(process.env.LOCALAPPDATA!, packageDotJson.name)
			: path.resolve(process.env.HOME!, `.${packageDotJson.name}`));
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
	mkdirSync(path.join(appDirPath, TORRENT_CACHE_FOLDER), { recursive: true });
	mkdirSync(path.join(appDirPath, LOGS_FOLDER), { recursive: true });
}

export function generateConfig(): void {
	createAppDirHierarchy();
	const dest = path.join(appDir(), "config.js");
	const templatePath = path.join("./config.template.cjs");
	if (existsSync(dest)) {
		console.log("Configuration file already exists.");
		return;
	}
	copyFileSync(new URL(templatePath, import.meta.url), dest);
	console.log("Configuration file created at", chalk.yellow.bold(dest));
}

export async function getFileConfig(): Promise<FileConfig> {
	if (process.env.DOCKER_ENV === "true") {
		generateConfig();
	}

	const configPath = path.join(appDir(), "config.js");

	try {
		return (await import(pathToFileURL(configPath).toString())).default;
	} catch (e) {
		if (e.code === "ERR_MODULE_NOT_FOUND") {
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

export function mergeConfig(
	currentConfig: FileConfig,
	newConfig: FileConfig,
): FileConfig {
	// Merge the current config with the new config
	const merged = { ...currentConfig };

	for (const [key, value] of Object.entries(newConfig)) {
		if (key in currentConfig) {
			if (typeof currentConfig[key] === typeof value) {
				// If the type matches, update the value
				merged[key] = value;
			} else if (
				Array.isArray(currentConfig[key]) &&
				Array.isArray(value)
			) {
				// If both are arrays, merge them
				merged[key] = value;
			} else {
				console.warn(
					`Type mismatch for key "${key}": expected ${typeof currentConfig[key]}, got ${typeof value}. Keeping original value.`,
				);
			}
		}
	}

	return merged;
}

export async function writeConfig(newConfig: FileConfig): Promise<void> {
	const configPath = path.join(appDir(), "config.js");

	// First, backup the existing config file
	const backupPath = `${configPath}.bak`;
	copyFileSync(configPath, backupPath);

	try {
		const originalConfig = readFileSync(configPath, "utf8");

		// parse the AST
		const ast = parse(originalConfig, {
			sourceType: "module",
			plugins: ["typescript"],
		});

		traverse.default(ast, {
			ObjectProperty(path) {
				if (
					path.node &&
					path.node.type === "ObjectProperty" &&
					t.isIdentifier(path.node.key)
				) {
					console.log("path.node.key", path.node.key);
					try {
						path.node.value = configObjectToAst(
							newConfig[path.node.key.name],
						);
					} catch (conversionError) {
						console.warn(
							`Failed to convert value for key "${path.node.key.type}": `,
							conversionError,
						);
					}
				}
			},
		});

		const output = generate(ast, {
			retainLines: true,
			comments: true,
		}).code;

		// Write the modified AST back to the file
		writeFileSync(configPath, output, "utf8");
	} catch (error) {
		console.error(`Error writting the new config: ${error}`);
	}
}

function configObjectToAst(obj: unknown): t.Expression {
	if (obj === null) return t.nullLiteral();
	if (obj === undefined) return t.identifier("undefined");
	if (typeof obj === "string") return t.stringLiteral(obj);
	if (typeof obj === "number") return t.numericLiteral(obj);
	if (typeof obj === "boolean") return t.booleanLiteral(obj);

	if (Array.isArray(obj)) {
		if (obj.length === 0) return t.identifier("undefined");

		const elements = obj.map((item) => configObjectToAst(item));
		return t.arrayExpression(elements);
	}

	if (typeof obj === "object") {
		const properties = Object.entries(obj).map(([key, value]) => {
			const keyNode = /^[a-zA-A_$][a-zA-Z0-9_$]*$/.test(key)
				? t.identifier(key)
				: t.stringLiteral(key);

			return t.objectProperty(keyNode, configObjectToAst(value));
		});

		return t.objectExpression(properties);
	}

	return t.identifier("undefined");
}
