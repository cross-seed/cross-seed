import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
const gitCmd = process.platform === "win32" ? "git.exe" : "git";
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const pkgDir = path.join(rootDir, "packages", "cross-seed");
const run = (cmd, argv) => {
	const res = spawnSync(cmd, argv, { stdio: "inherit", cwd: pkgDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const runGit = (argv) => {
	const res = spawnSync(gitCmd, argv, { stdio: "inherit", cwd: rootDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const gitStatus = () => {
	const res = spawnSync(gitCmd, ["status", "--porcelain"], {
		encoding: "utf8",
		cwd: rootDir,
	});
	if (res.status !== 0) process.exit(res.status ?? 1);
	return res.stdout.trim();
};

if (gitStatus()) {
	console.error("Working tree must be clean before releasing.");
	process.exit(1);
}

run(npmCmd, ["--workspaces=false", "login"]);
run(npmCmd, ["--workspaces=false", "version", rel]);

const dirty = gitStatus();
if (dirty) {
	const pkgJson = JSON.parse(
		fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
	);
	const files = [
		"packages/cross-seed/package.json",
		"package-lock.json",
		"packages/cross-seed/package-lock.json",
	].filter((file) => fs.existsSync(path.join(rootDir, file)));
	runGit(["add", ...files]);
	runGit(["commit", "-m", `v${pkgJson.version}`]);
	const tagCheck = spawnSync(gitCmd, ["tag", "-l", `v${pkgJson.version}`], {
		encoding: "utf8",
		cwd: rootDir,
	});
	if (tagCheck.status !== 0) process.exit(tagCheck.status ?? 1);
	if (!tagCheck.stdout.trim()) {
		runGit(["tag", `v${pkgJson.version}`]);
	}
}

const publishArgs = ["--workspaces=false", "publish"];
if (tag) publishArgs.push("--tag", tag);
run(npmCmd, publishArgs);
