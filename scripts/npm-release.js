import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const registry = "https://registry.npmjs.org";
const packageName = "cross-seed";

// Keep this helper dependency-free: the OIDC job never installs repository code.
export function parseVersion(version) {
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
			version,
		);
	assert.ok(match, `Unsupported release version: ${version}`);
	const identifiers = match[4]?.split(".");
	assert.ok(
		!identifiers?.some((part) => /^0\d+$/.test(part)),
		"Numeric prerelease identifiers cannot have leading zeroes",
	);
	return { numbers: match.slice(1, 4).map(BigInt), identifiers };
}

export function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	for (let index = 0; index < 3; index++) {
		if (a.numbers[index] !== b.numbers[index])
			return a.numbers[index] > b.numbers[index] ? 1 : -1;
	}
	if (!a.identifiers || !b.identifiers)
		return Number(!a.identifiers) - Number(!b.identifiers);
	for (
		let index = 0;
		index < Math.max(a.identifiers.length, b.identifiers.length);
		index++
	) {
		const x = a.identifiers[index];
		const y = b.identifiers[index];
		if (x === y) continue;
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const numericX = /^\d+$/.test(x);
		const numericY = /^\d+$/.test(y);
		if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
		if (numericX !== numericY) return numericX ? -1 : 1;
		return x > y ? 1 : -1;
	}
	return 0;
}

export function releaseMetadata(tag, version, commit) {
	const parsed = parseVersion(version);
	assert.ok(
		parsed.numbers[0] >= 7n,
		"This workflow only publishes the v7+ monorepo; v6 uses its legacy release process",
	);
	assert.equal(
		tag,
		`v${version}`,
		"Release tag must exactly match the package version",
	);
	assert.match(
		commit,
		/^[0-9a-f]{40}$/,
		"Expected an immutable full Git commit SHA",
	);
	return {
		name: packageName,
		version,
		tag,
		commit,
		channel: parsed.identifiers ? "next" : "latest",
	};
}

// npm provenance uses the workflow event's revision, not the checkout action's.
export function validateWorkflowContext(manifest, environment = process.env) {
	if (!environment.GITHUB_ACTIONS) return;
	assert.equal(
		environment.GITHUB_REPOSITORY,
		"cross-seed/cross-seed",
		"Only the canonical repository can publish",
	);
	assert.equal(
		environment.GITHUB_EVENT_NAME,
		"workflow_dispatch",
		"Publication must be deliberately dispatched",
	);
	assert.equal(
		environment.GITHUB_REF,
		`refs/tags/${manifest.tag}`,
		"Dispatch the workflow at the release tag, not a branch, so npm provenance identifies the tested source",
	);
	assert.equal(
		environment.GITHUB_SHA,
		manifest.commit,
		"Workflow provenance SHA differs from the tested source",
	);
}

export const integrityOf = (bytes) =>
	`sha512-${createHash("sha512").update(bytes).digest("base64")}`;

export function validateManifest(manifest, bytes) {
	const expected = releaseMetadata(
		manifest.tag,
		manifest.version,
		manifest.commit,
	);
	for (const key of Object.keys(expected))
		assert.equal(
			manifest[key],
			expected[key],
			`Invalid release manifest ${key}`,
		);
	assert.equal(
		manifest.integrity,
		integrityOf(bytes),
		"Release tarball differs from the tested artifact",
	);
}

export function checkChannel(manifest, tags) {
	const current = tags[manifest.channel];
	if (current)
		assert.ok(
			compareVersions(manifest.version, current) >= 0,
			`Refusing to move ${manifest.channel} backwards from ${current} to ${manifest.version}`,
		);
}

async function requestJSON(fetcher, path) {
	let response;
	try {
		response = await fetcher(`${registry}/${path}`, {
			headers: {
				"cache-control": "no-cache",
				accept: "application/json",
			},
			signal: AbortSignal.timeout(15000),
		});
	} catch (error) {
		throw new Error(
			`npm registry request failed for ${path}; no publication assumed`,
			{ cause: error },
		);
	}
	if ([202, 404].includes(response.status))
		return { status: response.status };
	assert.equal(
		response.status,
		200,
		`npm registry returned HTTP ${response.status} for ${path}`,
	);
	return { status: 200, value: await response.json() };
}

async function registryState(fetcher) {
	const result = await requestJSON(fetcher, packageName);
	assert.equal(
		result.status,
		200,
		"Cannot read existing npm package/dist-tags; refusing publication",
	);
	const tags = result.value["dist-tags"];
	assert.ok(
		tags && typeof tags === "object",
		"npm package response is missing dist-tags",
	);
	return tags;
}

function checkVersionMetadata(manifest, metadata) {
	assert.equal(
		metadata.name,
		manifest.name,
		"Registry package name mismatch",
	);
	assert.equal(
		metadata.version,
		manifest.version,
		"Registry version mismatch",
	);
	assert.equal(
		metadata.dist?.integrity,
		manifest.integrity,
		"Existing npm version has different bytes; never republish or skip this mismatch",
	);
	const url = new URL(metadata.dist.tarball);
	assert.equal(url.origin, registry, "Unexpected npm tarball origin");
	return url.href;
}

export const publicationArguments = (tarball, channel) => [
	"publish",
	tarball,
	"--tag",
	channel,
	"--access",
	"public",
	"--ignore-scripts",
	"--provenance",
	"--registry",
	registry,
];

export function isImmutableVersionConflict(error) {
	const output = `${error.stderr ?? ""}\n${error.stdout ?? ""}`;
	return (
		/npm (?:error|ERR!) code EPUBLISHCONFLICT\b/.test(output) ||
		(/npm (?:error|ERR!) code E403\b/.test(output) &&
			/cannot publish over (?:the )?previously published versions/i.test(
				output,
			))
	);
}

export async function publishArtifact(
	manifest,
	bytes,
	{
		fetcher = fetch,
		publish,
		sleep = delay,
		now = Date.now,
		timeoutMs = 30 * 60 * 1000,
		log = console.log,
	} = {},
) {
	validateManifest(manifest, bytes);
	const beforeTags = await registryState(fetcher);
	checkChannel(manifest, beforeTags);
	const initial = await requestJSON(
		fetcher,
		`${packageName}/${manifest.version}`,
	);
	if (initial.status === 200) checkVersionMetadata(manifest, initial.value);
	if (initial.status === 404) {
		assert.equal(
			typeof publish,
			"function",
			"A publication adapter is required for an unpublished version",
		);
		try {
			await publish(manifest.channel);
			log(
				"npm accepted the upload; waiting for public availability and dist-tag verification",
			);
		} catch (error) {
			// An accepted upload may remain GET-404 during scanning, including on a
			// workflow rerun. Only a specific immutable-version conflict is safe
			// to resume; auth/validation/network errors must still fail closed.
			if (!isImmutableVersionConflict(error)) throw error;
			log(
				"npm reports this version is already reserved; waiting to verify the existing upload's exact integrity and channel",
			);
		}
	} else {
		log(
			initial.status === 202
				? "Version is pending registry scanning; not uploading again"
				: "Version already exists with matching integrity; verifying availability without uploading again",
		);
	}

	const deadline = now() + timeoutMs;
	let backoff = 2000;
	while (true) {
		const version = await requestJSON(
			fetcher,
			`${packageName}/${manifest.version}`,
		);
		if (version.status === 200) {
			const tarballURL = checkVersionMetadata(manifest, version.value);
			const tags = await registryState(fetcher);
			checkChannel(manifest, tags);
			if (manifest.channel === "next")
				assert.equal(
					tags.latest,
					beforeTags.latest,
					"Stable npm latest changed during prerelease publication; investigate before reporting success",
				);
			if (tags[manifest.channel] === manifest.version) {
				const tarball = await fetcher(tarballURL, {
					signal: AbortSignal.timeout(30000),
				});
				if (tarball.status === 200) {
					assert.equal(
						integrityOf(Buffer.from(await tarball.arrayBuffer())),
						manifest.integrity,
						"Public npm tarball checksum differs from the tested artifact",
					);
					log(
						`Verified ${manifest.name}@${manifest.version}: public tarball checksum and ${manifest.channel} dist-tag match`,
					);
					return;
				}
				assert.ok(
					[202, 404].includes(tarball.status),
					`Published tarball returned HTTP ${tarball.status}`,
				);
			}
			if (
				initial.status === 200 &&
				tags[manifest.channel] !== manifest.version
			)
				throw new Error(
					`Existing version matches, but ${manifest.channel} points to ${tags[manifest.channel] ?? "nothing"}; no dist-tags were changed. Review the channel manually`,
				);
		}
		assert.ok(
			now() < deadline,
			`npm ${manifest.version} is not available with ${manifest.channel} after ${timeoutMs / 60000} minutes; scanning may still be pending. Do not bump or republish; rerun this workflow to verify`,
		);
		await sleep(Math.min(backoff, deadline - now()));
		backoff = Math.min(backoff * 2, 60000);
	}
}

function run(command, args, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const { echo = false, ...spawnOptions } = options;
		const child = spawn(command, args, {
			...spawnOptions,
			timeout: 5 * 60 * 1000,
		});
		let output = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			output = (output + chunk).slice(-1048576);
			if (echo) process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-1048576);
			if (echo) process.stderr.write(chunk);
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			if (code === 0) resolvePromise(output.trim());
			else {
				const error = new Error(
					`${command} ${args[0]} failed (${signal ?? code}): ${stderr}`,
				);
				Object.assign(error, { stderr, stdout: output });
				reject(error);
			}
		});
	});
}

async function assertSource(manifest, remote = false) {
	const git = (args) => run("git", args);
	assert.equal(
		await git(["rev-parse", "HEAD"]),
		manifest.commit,
		"Source checkout differs from the tested commit",
	);
	assert.equal(
		await git(["rev-parse", `refs/tags/${manifest.tag}^{commit}`]),
		manifest.commit,
		"Release tag no longer identifies the tested commit",
	);
	if (remote) {
		const refs = (
			await git([
				"ls-remote",
				"--exit-code",
				"origin",
				`refs/tags/${manifest.tag}`,
				`refs/tags/${manifest.tag}^{}`,
			])
		)
			.split("\n")
			.map((line) => line.split(/\s+/));
		const remoteCommit =
			refs.find(([, ref]) => ref.endsWith("^{}"))?.[0] ?? refs[0]?.[0];
		assert.equal(
			remoteCommit,
			manifest.commit,
			"Remote release tag moved after the package was tested",
		);
	}
}

async function main() {
	const [operation, directoryArg, tag] = process.argv.slice(2);
	if (operation === "check-source") {
		const pkg = JSON.parse(
			await readFile("cross-seed/package.json", "utf8"),
		);
		const commit = await run("git", ["rev-parse", "HEAD"]);
		const manifest = releaseMetadata(directoryArg, pkg.version, commit);
		await assertSource(manifest);
		validateWorkflowContext(manifest);
		await run("git", [
			"merge-base",
			"--is-ancestor",
			commit,
			"refs/remotes/origin/master",
		]);
		return;
	}
	assert.ok(
		directoryArg && ["prepare", "publish"].includes(operation),
		"Usage: node scripts/npm-release.js prepare|publish <artifact-directory> [release-tag]",
	);
	const directory = resolve(directoryArg);
	const bytes = await readFile(resolve(directory, "cross-seed.tgz"));
	const pkg = JSON.parse(
		await run("tar", [
			"-xOf",
			resolve(directory, "cross-seed.tgz"),
			"package/package.json",
		]),
	);
	let manifest;
	if (operation === "prepare") {
		const commit = await run("git", ["rev-parse", "HEAD"]);
		manifest = {
			...releaseMetadata(tag, pkg.version, commit),
			integrity: integrityOf(bytes),
		};
		assert.equal(pkg.name, packageName);
		await assertSource(manifest);
		validateWorkflowContext(manifest);
		await run("git", [
			"merge-base",
			"--is-ancestor",
			commit,
			"refs/remotes/origin/master",
		]);
		await writeFile(
			resolve(directory, "release.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		if (process.env.GITHUB_OUTPUT)
			await appendFile(
				process.env.GITHUB_OUTPUT,
				`commit=${commit}\nversion=${manifest.version}\nchannel=${manifest.channel}\n`,
			);
		console.log(JSON.stringify(manifest));
	} else {
		manifest = JSON.parse(
			await readFile(resolve(directory, "release.json"), "utf8"),
		);
		validateManifest(manifest, bytes);
		assert.equal(pkg.name, manifest.name);
		assert.equal(pkg.version, manifest.version);
		await assertSource(manifest, true);
		validateWorkflowContext(manifest);
		await publishArtifact(manifest, bytes, {
			publish: (channel) =>
				run(
					"npm",
					publicationArguments(
						resolve(directory, "cross-seed.tgz"),
						channel,
					),
					{ echo: true },
				),
		});
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	await main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
