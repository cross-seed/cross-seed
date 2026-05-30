import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const seaDir = join(repoRoot, "sea");
const nodeVersion = process.env.NODE_VERSION ?? process.version;
const targetFilter = process.env.SEA_TARGETS?.split(",")
	.map((target) => target.trim())
	.filter(Boolean);

const targets = [
	{ os: "linux", arch: "x64", archive: "tar.xz", binPath: "bin/node" },
	{ os: "linux", arch: "arm64", archive: "tar.xz", binPath: "bin/node" },
	{ os: "darwin", arch: "x64", archive: "tar.xz", binPath: "bin/node" },
	{ os: "darwin", arch: "arm64", archive: "tar.xz", binPath: "bin/node" },
	{ os: "win", arch: "x64", archive: "zip", binPath: "node.exe" },
	{ os: "win", arch: "arm64", archive: "zip", binPath: "node.exe" },
].filter(
	({ os, arch }) => !targetFilter || targetFilter.includes(`${os}-${arch}`),
);

function run(command, args, options = {}) {
	console.log(`> ${[command, ...args].join(" ")}`);
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			stdio: "inherit",
			...options,
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`${command} exited with ${signal ?? `status ${code}`}`,
				),
			);
		});
	});
}

async function download(url, outputPath) {
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}
	await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}

async function listFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(dir, entry.name);
			return entry.isDirectory() ? listFiles(entryPath) : entryPath;
		}),
	);
	return files.flat();
}

async function createWebuiAssets() {
	const webuiDist = join(repoRoot, "cross-seed/dist/webui");
	const files = await listFiles(webuiDist);
	return Object.fromEntries(
		files.map((file) => [
			`webui/${relative(webuiDist, file).split("\\").join("/")}`,
			file,
		]),
	);
}

async function getNodeExecutable({ os, arch, archive, binPath }) {
	const distName = `node-${nodeVersion}-${os}-${arch}`;
	const archiveName = `${distName}.${archive}`;
	const archivePath = join(seaDir, archiveName);
	const extractDir = join(seaDir, "node-binaries", `${os}-${arch}`);
	const executablePath = join(extractDir, distName, binPath);

	await rm(extractDir, { recursive: true, force: true });
	await mkdir(extractDir, { recursive: true });

	const url = `https://nodejs.org/dist/${nodeVersion}/${archiveName}`;
	console.log(`Downloading ${url}`);
	await download(url, archivePath);

	if (archive === "zip" && process.platform === "win32") {
		await run("powershell", [
			"-NoProfile",
			"-Command",
			"Expand-Archive",
			"-LiteralPath",
			archivePath,
			"-DestinationPath",
			extractDir,
		]);
	} else if (archive === "zip") {
		await run("unzip", ["-q", archivePath, "-d", extractDir]);
	} else {
		await run("tar", ["-xf", archivePath, "-C", extractDir]);
	}
	await rm(archivePath);
	await chmod(executablePath, 0o755);
	return executablePath;
}

async function signDarwinBinary(outputPath) {
	if (process.platform !== "darwin") return;
	await run("codesign", ["--sign", "-", outputPath]);
}

async function buildTarget(target, bundlePath, assets) {
	const targetName = `${target.os}-${target.arch}`;
	const nodeExecutable = await getNodeExecutable(target);
	const outputPath = join(
		seaDir,
		`cross-seed-${targetName}${extname(basename(target.binPath))}`,
	);
	const configPath = join(seaDir, `sea-${targetName}.json`);

	await rm(outputPath, { force: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				main: bundlePath,
				mainFormat: "module",
				executable: nodeExecutable,
				output: outputPath,
				disableExperimentalSEAWarning: true,
				useCodeCache: false,
				useSnapshot: false,
				assets,
			},
			null,
			"\t",
		),
	);

	await run(process.execPath, ["--build-sea", configPath]);
	if (target.os === "darwin") {
		await signDarwinBinary(outputPath);
	}
	console.log(`Built ${outputPath}`);
}

async function main() {
	if (targets.length === 0) {
		throw new Error("SEA_TARGETS did not match any known targets");
	}

	await rm(seaDir, { recursive: true, force: true });
	await mkdir(seaDir, { recursive: true });

	const bundlePath = join(seaDir, "bundle.mjs");
	await esbuild.build({
		entryPoints: [join(repoRoot, "cross-seed/dist/cmd.js")],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node26",
		outfile: bundlePath,
		banner: {
			js: 'import { createRequire as __crossSeedCreateRequire } from "node:module";\nconst require = __crossSeedCreateRequire(import.meta.url);',
		},
		external: [
			"better-sqlite3",
			"mysql",
			"mysql2",
			"oracledb",
			"pg",
			"pg-query-stream",
			"sqlite3",
			"tedious",
		],
	});

	const assets = await createWebuiAssets();
	for (const target of targets) {
		await buildTarget(target, bundlePath, assets);
	}

	await cp(
		join(repoRoot, "cross-seed/package.json"),
		join(seaDir, "package.json"),
	);
	await rm(join(seaDir, "node-binaries"), { recursive: true, force: true });
	await rm(join(tmpdir(), "node-compile-cache"), {
		recursive: true,
		force: true,
	});
}

await main();
