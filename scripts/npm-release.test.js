import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	compareVersions,
	integrityOf,
	isImmutableVersionConflict,
	publicationArguments,
	publishArtifact,
	releaseMetadata,
	validateManifest,
	validateWorkflowContext,
} from "./npm-release.js";

const bytes = Buffer.from("the exact tested release artifact");
const sha = "a".repeat(40);
const manifestFor = (version = "7.0.0-27") => ({
	...releaseMetadata(`v${version}`, version, sha),
	integrity: integrityOf(bytes),
});
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });

function registryFixture({
	manifest = manifestFor(),
	versions = [404, 200],
	tags = [
		{ latest: "6.13.9", next: "7.0.0-26" },
		{ latest: "6.13.9", next: manifest.version },
	],
	remoteBytes = bytes,
	tarballStatus = [200],
	metadataOverride = {},
	rootStatus = 200,
} = {}) {
	const calls = [];
	let clock = 0;
	let versionIndex = 0;
	let tagIndex = 0;
	let tarballIndex = 0;
	const fetcher = async (url) => {
		calls.push(url);
		assert.match(url, /^https:\/\/registry\.npmjs\.org\/cross-seed/);
		if (url.endsWith(".tgz")) {
			const status =
				tarballStatus[
					Math.min(tarballIndex++, tarballStatus.length - 1)
				];
			return new Response(status === 200 ? remoteBytes : "pending", {
				status,
			});
		}
		if (url.endsWith(`/${manifest.version}`)) {
			const status =
				versions[Math.min(versionIndex++, versions.length - 1)];
			return json(
				status === 200
					? {
							name: manifest.name,
							version: manifest.version,
							dist: {
								integrity: manifest.integrity,
								tarball: `https://registry.npmjs.org/cross-seed/-/cross-seed-${manifest.version}.tgz`,
							},
							...metadataOverride,
						}
					: { error: "not available" },
				status,
			);
		}
		return json(
			{ "dist-tags": tags[Math.min(tagIndex++, tags.length - 1)] },
			rootStatus,
		);
	};
	const publishes = [];
	const sleeps = [];
	return {
		manifest,
		calls,
		publishes,
		sleeps,
		adapters: {
			fetcher,
			publish: async (channel) => {
				publishes.push(channel);
			},
			now: () => clock,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
				clock += milliseconds;
			},
			timeoutMs: 20000,
			log: () => {},
		},
	};
}

for (const [version, channel] of [
	["7.0.0-27", "next"],
	["7.0.0-rc.1", "next"],
	["7.0.0", "latest"],
	["8.2.3", "latest"],
]) {
	test(`${version} selects ${channel}`, () =>
		assert.equal(manifestFor(version).channel, channel));
}
for (const [tag, version, commit] of [
	["v6.13.10", "6.13.10", sha],
	["v7.0.1", "7.0.0", sha],
	["v7.0.0", "7.0.0", "master"],
	["v7.0.0-01", "7.0.0-01", sha],
	["v7.0.0+build", "7.0.0+build", sha],
	["v07.0.0", "07.0.0", sha],
]) {
	test(`rejects ambiguous/non-v7 release ${tag}/${commit}`, () =>
		assert.throws(() => releaseMetadata(tag, version, commit)));
}

test("semver ordering includes numeric prereleases and stable precedence", () => {
	const ordered = [
		"6.13.9",
		"7.0.0-2",
		"7.0.0-10",
		"7.0.0-alpha",
		"7.0.0-alpha.1",
		"7.0.0-beta",
		"7.0.0",
		"7.0.1",
		"7.1.0-0",
		"8.0.0",
	];
	for (let index = 1; index < ordered.length; index++) {
		assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1);
		assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
		assert.equal(compareVersions(ordered[index], ordered[index]), 0);
	}
});

test("rejects modified artifact or manifest before touching registry", async () => {
	const fixture = registryFixture();
	assert.throws(
		() => validateManifest(fixture.manifest, Buffer.from("changed")),
		/differs/,
	);
	await assert.rejects(
		publishArtifact(
			{ ...fixture.manifest, channel: "latest" },
			bytes,
			fixture.adapters,
		),
		/manifest channel/,
	);
	assert.equal(fixture.calls.length, 0);
});

test("publishes once, tolerates scan 202/404, verifies exact public bytes and next", async () => {
	const fixture = registryFixture({ versions: [404, 202, 404, 200] });
	await publishArtifact(fixture.manifest, bytes, fixture.adapters);
	assert.deepEqual(fixture.publishes, ["next"]);
	assert.deepEqual(fixture.sleeps, [2000, 4000]);
	assert.ok(fixture.calls.at(-1).endsWith(".tgz"));
});

test("pending upload rerun does not publish again", async () => {
	const fixture = registryFixture({ versions: [202, 202, 200] });
	await publishArtifact(fixture.manifest, bytes, fixture.adapters);
	assert.deepEqual(fixture.publishes, []);
});

test("available matching version rerun verifies and does not publish", async () => {
	const fixture = registryFixture({
		versions: [200],
		tags: [{ latest: "6.13.9", next: "7.0.0-27" }],
	});
	await publishArtifact(fixture.manifest, bytes, fixture.adapters);
	assert.deepEqual(fixture.publishes, []);
});

test("stable release updates only latest and tolerates an older next", async () => {
	const manifest = manifestFor("7.0.0");
	const fixture = registryFixture({
		manifest,
		tags: [
			{ latest: "6.13.9", next: "7.0.0-26" },
			{ latest: "7.0.0", next: "7.0.0-26" },
		],
	});
	await publishArtifact(manifest, bytes, fixture.adapters);
	assert.deepEqual(fixture.publishes, ["latest"]);
});

for (const manifest of [manifestFor("7.0.0"), manifestFor("7.0.0-27")]) {
	test(`refuses backwards channel movement for ${manifest.channel}`, async () => {
		const fixture = registryFixture({
			manifest,
			tags: [{ [manifest.channel]: "7.1.0" }],
		});
		await assert.rejects(
			publishArtifact(manifest, bytes, fixture.adapters),
			/backwards/,
		);
		assert.deepEqual(fixture.publishes, []);
	});
}

test("existing version with different integrity cannot be skipped or published", async () => {
	const fixture = registryFixture({
		versions: [200],
		metadataOverride: { dist: { integrity: "sha512-different" } },
	});
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/different bytes/,
	);
	assert.deepEqual(fixture.publishes, []);
});

test("verifies downloaded bytes rather than trusting metadata integrity", async () => {
	const fixture = registryFixture({
		remoteBytes: Buffer.from("not our artifact"),
	});
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/checksum differs/,
	);
});

test("pending public tarball is not reported available", async () => {
	const fixture = registryFixture({ tarballStatus: [202, 404, 200] });
	await publishArtifact(fixture.manifest, bytes, fixture.adapters);
	assert.deepEqual(fixture.sleeps, [2000, 4000]);
});

test("times out with actionable pending message and no duplicate upload", async () => {
	const fixture = registryFixture({ versions: [404, 202] });
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/scanning may still be pending.*rerun/s,
	);
	assert.deepEqual(fixture.publishes, ["next"]);
	assert.equal(
		fixture.sleeps.reduce((total, ms) => total + ms, 0),
		20000,
	);
});

for (const status of [401, 403, 429, 500]) {
	test(`registry HTTP ${status} is not mistaken for a missing package`, async () => {
		const fixture = registryFixture({ rootStatus: status });
		await assert.rejects(
			publishArtifact(fixture.manifest, bytes, fixture.adapters),
			new RegExp(`HTTP ${status}`),
		);
		assert.deepEqual(fixture.publishes, []);
	});
}

test("network failure fails closed", async () => {
	let published = false;
	await assert.rejects(
		publishArtifact(manifestFor(), bytes, {
			fetcher: async () => {
				throw new Error("offline");
			},
			publish: async () => {
				published = true;
			},
		}),
		/registry request failed/,
	);
	assert.equal(published, false);
});

test("publish authentication failure does not claim success", async () => {
	const fixture = registryFixture();
	fixture.adapters.publish = async () => {
		throw new Error("npm E403");
	};
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/E403/,
	);
	assert.equal(fixture.calls.length, 2);
});

test("does not silently retag a matching preexisting version", async () => {
	const fixture = registryFixture({
		versions: [200],
		tags: [{ latest: "6.13.9", next: "7.0.0-26" }],
	});
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/no dist-tags were changed/,
	);
	assert.deepEqual(fixture.publishes, []);
});

test("prerelease detects unexpected stable-channel change", async () => {
	const fixture = registryFixture({
		tags: [{ latest: "6.13.9" }, { latest: "7.0.0", next: "7.0.0-27" }],
	});
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/latest changed/,
	);
});

test("npm invocation publishes the exact artifact without lifecycle scripts", () => {
	assert.deepEqual(
		publicationArguments("/tmp/tested/cross-seed.tgz", "next"),
		[
			"publish",
			"/tmp/tested/cross-seed.tgz",
			"--tag",
			"next",
			"--access",
			"public",
			"--ignore-scripts",
			"--provenance",
			"--registry",
			"https://registry.npmjs.org",
		],
	);
});

for (const stderr of [
	"npm error code EPUBLISHCONFLICT\nnpm error Cannot publish over existing version.",
	"npm error code E403\nnpm error 403 You cannot publish over previously published versions: 7.0.0-27.",
]) {
	test(`reserved version with GET-404 resumes verification: ${stderr.split("\n")[0]}`, async () => {
		const fixture = registryFixture({ versions: [404, 404, 404, 200] });
		let attempts = 0;
		fixture.adapters.publish = async () => {
			attempts++;
			throw Object.assign(new Error("npm failed"), { stderr });
		};
		await publishArtifact(fixture.manifest, bytes, fixture.adapters);
		assert.equal(attempts, 1);
		assert.deepEqual(fixture.sleeps, [2000, 4000]);
	});
}

test("reserved-version conflict must still verify the public checksum", async () => {
	const fixture = registryFixture({
		versions: [404, 404, 200],
		remoteBytes: Buffer.from("another upload"),
	});
	fixture.adapters.publish = async () => {
		throw Object.assign(new Error("npm failed"), {
			stderr: "npm error code EPUBLISHCONFLICT",
		});
	};
	await assert.rejects(
		publishArtifact(fixture.manifest, bytes, fixture.adapters),
		/checksum differs/,
	);
});

for (const stderr of [
	"npm error code E403\nnpm error You do not have permission to publish cross-seed.",
	"npm error code E401\nnpm error Unable to authenticate.",
	"npm error code E404\nnpm error Not found or you do not have permission to access it.",
	"npm error code E422\nnpm error Invalid package.json",
]) {
	test(`publication ${stderr.split("\n")[0]} is never swallowed as a version conflict`, async () => {
		assert.equal(isImmutableVersionConflict({ stderr }), false);
		const fixture = registryFixture();
		fixture.adapters.publish = async () => {
			throw Object.assign(new Error("publish refused"), { stderr });
		};
		await assert.rejects(
			publishArtifact(fixture.manifest, bytes, fixture.adapters),
			/publish refused/,
		);
		assert.equal(fixture.calls.length, 2);
	});
}

test("prepare CLI binds the actual package, exact tag and commit, and master ancestry", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "cross-seed-release-test-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const command = promisify(execFile);
	const git = (...args) => command("git", args, { cwd: root });
	await git("init", "--initial-branch", "master");
	await git("config", "user.name", "Release Test");
	await git("config", "user.email", "release-test@example.invalid");
	await writeFile(join(root, "README"), "release fixture");
	await git("add", "README");
	await git("commit", "-m", "fixture");
	const commit = (await git("rev-parse", "HEAD")).stdout.trim();
	await git("tag", "v7.0.0-27");
	await git("update-ref", "refs/remotes/origin/master", commit);
	await mkdir(join(root, "package"));
	await mkdir(join(root, "artifact"));
	await writeFile(
		join(root, "package/package.json"),
		JSON.stringify({ name: "cross-seed", version: "7.0.0-27" }),
	);
	const pack = () =>
		command(
			"tar",
			["-czf", join(root, "artifact/cross-seed.tgz"), "package"],
			{ cwd: root },
		);
	await pack();
	const script = fileURLToPath(new URL("./npm-release.js", import.meta.url));
	const prepare = (tag = "v7.0.0-27") =>
		command(process.execPath, [script, "prepare", "artifact", tag], {
			cwd: root,
			// This is a temporary local Git fixture, not the enclosing CI source.
			env: { ...process.env, GITHUB_ACTIONS: "" },
		});
	await prepare();
	const manifest = JSON.parse(
		await readFile(join(root, "artifact/release.json"), "utf8"),
	);
	assert.equal(manifest.commit, commit);
	assert.equal(manifest.channel, "next");
	assert.equal(
		manifest.integrity,
		integrityOf(await readFile(join(root, "artifact/cross-seed.tgz"))),
	);
	await assert.rejects(prepare("v7.0.0-28"), /tag must exactly match/);

	await git("update-ref", "-d", "refs/remotes/origin/master");
	await assert.rejects(prepare(), /merge-base failed/);
	await git("update-ref", "refs/remotes/origin/master", commit);
	await writeFile(
		join(root, "package/package.json"),
		JSON.stringify({ name: "wrong-package", version: "7.0.0-27" }),
	);
	await pack();
	await assert.rejects(prepare(), /wrong-package/);
	await writeFile(
		join(root, "package/package.json"),
		JSON.stringify({ name: "cross-seed", version: "7.0.0-27" }),
	);
	await pack();

	await writeFile(join(root, "README"), "different commit");
	await git("add", "README");
	await git("commit", "-m", "different fixture");
	await assert.rejects(prepare(), /tag no longer identifies/);
});

test("workflow provenance must identify the exact release tag and SHA", () => {
	const manifest = manifestFor();
	const environment = {
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "cross-seed/cross-seed",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_REF: `refs/tags/${manifest.tag}`,
		GITHUB_SHA: manifest.commit,
	};
	validateWorkflowContext(manifest, environment);
	validateWorkflowContext(manifest, {
		...environment,
		GITHUB_EVENT_NAME: "release",
	});
	validateWorkflowContext(manifest, {});
	for (const override of [
		{ GITHUB_REF: "refs/heads/master" },
		{ GITHUB_SHA: "b".repeat(40) },
		{ GITHUB_REPOSITORY: "another/cross-seed" },
		{ GITHUB_EVENT_NAME: "push" },
	])
		assert.throws(() =>
			validateWorkflowContext(manifest, { ...environment, ...override }),
		);
});
