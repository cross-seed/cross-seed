import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name) => {
	const hit = args.findIndex(
		(arg) => arg === `--${name}` || arg.startsWith(`--${name}=`),
	);
	if (hit === -1) return undefined;
	const raw = args[hit];
	if (raw.includes("=")) return raw.split("=").slice(1).join("=");
	return args[hit + 1];
};

const rel =
	process.env.npm_config_release ||
	getArg("release") ||
	args.find((arg) => !arg.startsWith("-"));
const explicitTag = process.env.npm_config_tag || getArg("tag");

if (!rel) {
	console.error(
		"Usage: npm run release -- --release=patch|minor|major|prepatch|preminor|premajor|prerelease [--tag=next]",
	);
	process.exit(1);
}

const isPrerelease = rel.startsWith("pre") || rel.includes("-");
const tag = explicitTag ?? (isPrerelease ? "next" : undefined);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const pkgDir = path.join(rootDir, "packages", "cross-seed");
const run = (cmd, argv) => {
	const res = spawnSync(cmd, argv, { stdio: "inherit", cwd: pkgDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};

run(npmCmd, ["--workspaces=false", "version", rel]);

const publishArgs = ["--workspaces=false", "publish"];
if (tag) publishArgs.push("--tag", tag);
run(npmCmd, publishArgs);
