import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Exercise real Git commits, tags and pushes against a disposable local remote.
// npm/gh are record-only adapters: these tests cannot publish to any service.
async function fixture(context, version = "7.0.0-28", realNpm = false) {
	const root = await mkdtemp(join(tmpdir(), "cross-seed-release-command-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repo = join(root, "repo");
	const remote = join(root, "remote.git");
	const bin = join(root, "bin");
	await mkdir(join(repo, "scripts"), { recursive: true });
	await mkdir(join(repo, "cross-seed"));
	await mkdir(bin);
	await cp(
		new URL("./release.js", import.meta.url),
		join(repo, "scripts/release.js"),
	);
	await writeFile(
		join(repo, "package.json"),
		JSON.stringify({
			name: "release-fixture",
			version: "0.0.0",
			private: true,
			type: "module",
			workspaces: ["cross-seed"],
		}),
	);
	await writeFile(
		join(repo, "cross-seed/package.json"),
		JSON.stringify({ name: "cross-seed", version: "7.0.0-27" }),
	);
	await writeFile(join(repo, "package-lock.json"), "{}");
	const log = join(root, "commands.jsonl");
	const adapter = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const name = path.basename(process.argv[1]);
fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify({name,args})+'\\n');
if(name==='npm') {
 if(args.includes('version')) {
  const filename=path.join(process.cwd(),'package.json');
  const pkg=JSON.parse(fs.readFileSync(filename,'utf8'));
  pkg.version=process.env.RELEASE_TEST_VERSION;
  fs.writeFileSync(filename,JSON.stringify(pkg));
 } else if(args[0]==='install') {
  fs.writeFileSync('package-lock.json',JSON.stringify({version:process.env.RELEASE_TEST_VERSION}));
 } else { throw new Error('Unexpected npm command: '+args.join(' ')); }
}
`;
	for (const name of realNpm ? ["gh"] : ["npm", "gh"])
		await writeFile(join(bin, name), adapter, { mode: 0o755 });
	const env = {
		...process.env,
		PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
		RELEASE_TEST_LOG: log,
		RELEASE_TEST_VERSION: version,
	};
	delete env.npm_config_release;
	delete env.npm_config_tag;
	if (realNpm) env.npm_config_offline = "true";
	const git = (...args) => exec("git", args, { cwd: repo, env });
	await exec("git", ["init", "--bare", remote], { env });
	await git("init", "-b", "master");
	await git("config", "user.name", "Release test");
	await git("config", "user.email", "release-test@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("add", ".");
	await git("commit", "-m", "fixture");
	await git("remote", "add", "origin", remote);
	await git("push", "-u", "origin", "master");
	await git("tag", "-a", "unrelated-local-tag", "-m", "Not a release");
	await git("config", "push.followTags", "true");
	return {
		repo,
		git,
		run: (...args) =>
			exec(
				process.execPath,
				[join(repo, "scripts/release.js"), ...args],
				{ cwd: repo, env },
			),
		commands: async () =>
			(await readFile(log, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
		remoteRefs: async () => (await git("ls-remote", "origin")).stdout,
	};
}

const options = { skip: process.platform === "win32" };

test(
	"an existing release tag is never reused or pushed",
	options,
	async (context) => {
		const f = await fixture(context);
		await f.git("tag", "v7.0.0-28");
		const before = await f.remoteRefs();
		const tagBefore = (await f.git("rev-parse", "v7.0.0-28")).stdout;
		await assert.rejects(f.run("--release=prerelease"), /already exists/);
		assert.equal(await f.remoteRefs(), before);
		assert.equal((await f.git("rev-parse", "v7.0.0-28")).stdout, tagBefore);
	},
);

test(
	"real offline npm updates the package and workspace lockfile without publishing",
	options,
	async (context) => {
		const f = await fixture(context, "7.0.0-28", true);
		await f.run("--release=prerelease", "--no-push");
		const pkg = JSON.parse(
			await readFile(join(f.repo, "cross-seed/package.json"), "utf8"),
		);
		const lock = JSON.parse(
			await readFile(join(f.repo, "package-lock.json"), "utf8"),
		);
		assert.equal(pkg.version, "7.0.0-28");
		assert.equal(lock.packages["cross-seed"].version, pkg.version);
		assert.equal(lock.packages[""].version, "0.0.0");
		assert.equal((await f.git("status", "--porcelain")).stdout, "");
	},
);

test(
	"release command pushes only its release tag and delegates publication to Actions",
	options,
	async (context) => {
		const f = await fixture(context);
		await f.run("--release=prerelease");
		const calls = await f.commands();
		assert.deepEqual(
			calls.filter((c) => c.name === "npm").map((c) => c.args),
			[
				[
					"--workspaces=false",
					"version",
					"prerelease",
					"--git-tag-version=false",
					"--ignore-scripts",
				],
				[
					"install",
					"--package-lock-only",
					"--ignore-scripts",
					"--no-audit",
					"--no-fund",
				],
			],
		);
		const release = calls.find(
			(c) => c.name === "gh" && c.args[0] === "release",
		);
		assert(release.args.includes("v7.0.0-28"));
		assert(release.args.includes("--prerelease"));
		assert(release.args.includes("--generate-notes"));
		const head = (await f.git("rev-parse", "HEAD")).stdout.trim();
		assert.equal(
			(await f.git("rev-parse", "v7.0.0-28")).stdout.trim(),
			head,
		);
		assert.match(await f.remoteRefs(), /refs\/tags\/v7\.0\.0-28/);
		assert.doesNotMatch(await f.remoteRefs(), /unrelated-local-tag/);
		assert.equal((await f.git("status", "--porcelain")).stdout, "");
	},
);

test(
	"stable releases omit the GitHub prerelease flag",
	options,
	async (context) => {
		const f = await fixture(context, "7.0.0");
		await f.run("--release=7.0.0");
		const release = (await f.commands()).find(
			(c) => c.name === "gh" && c.args[0] === "release",
		);
		assert(release.args.includes("v7.0.0"));
		assert(!release.args.includes("--prerelease"));
	},
);

test("draft releases wait for GitHub publication", options, async (context) => {
	const f = await fixture(context);
	const result = await f.run("--release=prerelease", "--draft");
	const release = (await f.commands()).find(
		(c) => c.name === "gh" && c.args[0] === "release",
	);
	assert(release.args.includes("--draft"));
	assert.match(result.stdout, /Publish it on GitHub/);
});

test(
	"no-push prepares a local release without creating a remote release",
	options,
	async (context) => {
		const f = await fixture(context);
		const before = await f.remoteRefs();
		const result = await f.run("--release=prerelease", "--no-push");
		assert.equal(await f.remoteRefs(), before);
		assert(!(await f.commands()).some((c) => c.name === "gh"));
		assert.match(result.stdout, /Nothing was pushed or published/);
		assert.equal(
			(await f.git("rev-parse", "v7.0.0-28")).stdout,
			(await f.git("rev-parse", "HEAD")).stdout,
		);
	},
);

test(
	"no-release pushes its tag without publishing to npm or creating a GitHub release",
	options,
	async (context) => {
		const f = await fixture(context);
		await f.run("--release=prerelease", "--no-release");
		assert.match(await f.remoteRefs(), /refs\/tags\/v7\.0\.0-28/);
		assert(!(await f.commands()).some((c) => c.name === "gh"));
	},
);

test(
	"release preparation refuses an unmerged source branch",
	options,
	async (context) => {
		const f = await fixture(context);
		await f.git("switch", "-c", "unfinished-work");
		await assert.rejects(
			f.run("--release=prerelease"),
			/Release from master/,
		);
		assert.equal((await f.git("status", "--porcelain")).stdout, "");
	},
);

test(
	"release preparation refuses a contradictory npm channel before mutation",
	options,
	async (context) => {
		const f = await fixture(context);
		await assert.rejects(
			f.run("--release=prerelease", "--tag=latest"),
			/cannot override/,
		);
		assert.equal((await f.git("status", "--porcelain")).stdout, "");
	},
);
