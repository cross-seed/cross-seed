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
const hasFlag = (name) => args.includes(`--${name}`);

const rel =
	process.env.npm_config_release ||
	getArg("release") ||
	args.find((arg) => !arg.startsWith("-"));
const explicitTag = process.env.npm_config_tag || getArg("tag");
const draftRelease = hasFlag("draft");
const skipPush = hasFlag("no-push");
const skipRelease = hasFlag("no-release") || skipPush;

if (!rel) {
	console.error(
		"Usage: npm run release -- --release=patch|minor|major|prepatch|preminor|premajor|prerelease [--tag=next] [--draft] [--no-release] [--no-push]",
	);
	process.exit(1);
}

const isPrerelease = rel.startsWith("pre") || rel.includes("-");
const channel = isPrerelease ? "next" : "latest";
if (explicitTag && explicitTag !== channel) {
	console.error(
		`Release workflows select ${channel} for this version; --tag cannot override it.`,
	);
	process.exit(1);
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const ghCmd = process.platform === "win32" ? "gh.exe" : "gh";
const gitCmd = process.platform === "win32" ? "git.exe" : "git";
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const pkgDir = path.join(rootDir, "cross-seed");
const run = (cmd, argv) => {
	const res = spawnSync(cmd, argv, { stdio: "inherit", cwd: pkgDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const runRoot = (cmd, argv) => {
	const res = spawnSync(cmd, argv, { stdio: "inherit", cwd: rootDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const runGh = (argv) => {
	const res = spawnSync(ghCmd, argv, { stdio: "inherit", cwd: rootDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const runGit = (argv) => {
	const res = spawnSync(gitCmd, argv, { stdio: "inherit", cwd: rootDir });
	if (res.status !== 0) process.exit(res.status ?? 1);
};
const gitOutput = (argv) => {
	const res = spawnSync(gitCmd, argv, {
		encoding: "utf8",
		cwd: rootDir,
	});
	if (res.status !== 0) process.exit(res.status ?? 1);
	return res.stdout.trim();
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

if (gitOutput(["branch", "--show-current"]) !== "master") {
	console.error(
		"Release from master after the reviewed changes have landed.",
	);
	process.exit(1);
}

if (
	gitOutput(["rev-parse", "HEAD"]) !==
	gitOutput(["rev-parse", "refs/remotes/origin/master"])
) {
	console.error(
		"Local master must match origin/master before preparing a release.",
	);
	process.exit(1);
}

if (!skipRelease) {
	const ghCheck = spawnSync(ghCmd, ["--version"], {
		stdio: "ignore",
		cwd: rootDir,
	});
	if (ghCheck.status !== 0) {
		console.error(
			"GitHub CLI (gh) is required to create releases. Install it or pass --no-release.",
		);
		process.exit(1);
	}
}

run(npmCmd, [
	"--workspaces=false",
	"version",
	rel,
	"--git-tag-version=false",
	"--ignore-scripts",
]);
runRoot(npmCmd, [
	"install",
	"--package-lock-only",
	"--ignore-scripts",
	"--no-audit",
	"--no-fund",
]);

const pkgJson = JSON.parse(
	fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
);
const tagName = `v${pkgJson.version}`;
if (gitOutput(["tag", "-l", tagName])) {
	console.error(
		`${tagName} already exists. Retry its Actions workflow instead of preparing the release again.`,
	);
	process.exit(1);
}
const dirty = gitStatus();
if (dirty) {
	const files = [
		"cross-seed/package.json",
		"package-lock.json",
		"cross-seed/package-lock.json",
	].filter((file) => fs.existsSync(path.join(rootDir, file)));
	runGit(["add", ...files]);
	runGit(["commit", "-m", `v${pkgJson.version}`]);
	runGit(["tag", tagName]);
}

if (!skipPush) {
	runGit(["push", "--no-follow-tags", "origin", "HEAD:refs/heads/master"]);
	runGit(["push", "--no-follow-tags", "origin", `refs/tags/${tagName}`]);
}

if (!skipRelease) {
	const releaseArgs = [
		"release",
		"create",
		tagName,
		"--generate-notes",
		"--target",
		gitOutput(["rev-parse", "HEAD"]),
	];
	if (draftRelease) releaseArgs.push("--draft");
	if (isPrerelease) releaseArgs.push("--prerelease");
	runGh(releaseArgs);
	console.log(
		draftRelease
			? "Draft created. Publish it on GitHub to start npm and standalone releases. Docker builds run from the pushed tag."
			: "GitHub Actions will publish npm with trusted credentials and build standalone binaries. Check the release workflows for completion; Docker builds run from the pushed tag.",
	);
} else {
	console.log(
		skipPush
			? "Release commit and tag prepared locally. Nothing was pushed or published."
			: "Release tag pushed. Publish the GitHub release to start npm and standalone releases; npm was not published locally.",
	);
}
