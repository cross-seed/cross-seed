import * as esbuild from "esbuild";
import { exec } from "node:child_process";
import { inject } from "postject";
import { readFile, rename, writeFile } from "fs/promises";
import chalk from "chalk";
import { mkdir, rm } from "node:fs/promises";
import { basename, extname, join } from "path";

const NODE_VERSION = "v22.13.0";
const platforms = [
	{ os: "linux", arch: "x64", binPath: "/bin/node" },
	{ os: "linux", arch: "arm64", binPath: "/bin/node" },
	{ os: "darwin", arch: "x64", binPath: "/bin/node" },
	{ os: "darwin", arch: "arm64", binPath: "/bin/node" },
	{ os: "win", arch: "x64", binPath: "/node.exe", archive: ".zip" },
	{ os: "win", arch: "arm64", binPath: "/node.exe", archive: ".zip" },
];

async function run(cmd, { silent = false } = {}) {
	const { promise, resolve, reject } = Promise.withResolvers();

	console.log(chalk.bold(`Running: ${cmd}`));
	const proc = exec(cmd, { encoding: "utf8" }, (err, data) => {
		if (err) reject(err);
		resolve(data);
	});
	if (!silent) {
		proc.stdout.on("data", (data) => {
			process.stdout.write(
				data
					.split("\n")
					.map((line) => `\t${line}`)
					.join("\n"),
			);
		});

		proc.stderr.on("data", (data) => {
			process.stderr.write(
				chalk.red(
					data
						.split("\n")
						.map((line) => (line ? `\t${line}` : line))
						.join("\n"),
				),
			);
		});
	}
	await promise;
	console.log(chalk.green("Done"));
}
async function createBinary(blob, { os, arch, binPath, archive = ".tar.gz" }) {
	const filePath = `sea/cross-seed-${os}-${arch}${extname(basename(binPath))}`;
	const distName = `node-${NODE_VERSION}-${os}-${arch}`;
	const tarball = `${distName}${archive}`;

	await run(
		`curl https://nodejs.org/dist/${NODE_VERSION}/${tarball} -o sea/${tarball}`,
	);
	if (archive === ".zip") {
		await run(`unzip -d sea sea/${tarball} ${join(distName, binPath)}`);
		await rm(`sea/${tarball}`);
		await rename(`sea/${join(distName, binPath)}`, filePath);
		await rm(join("sea", distName), { recursive: true });
	} else {
		await run(`tar -x -C sea -f sea/${tarball} ${join(distName, binPath)}`);
		await rm(`sea/${tarball}`);
		await rename(`sea/${distName}${binPath}`, filePath);
		await rm(join("sea", distName), { recursive: true });
	}

	if (os === "darwin") {
		await run(`codesign --remove-signature ${filePath}`);
	}

	await inject(filePath, "NODE_SEA_BLOB", blob, {
		// this is a special fuse that tells Node it's been modified
		sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
		machoSegmentName: "NODE_SEA",
	});

	if (os === "darwin") {
		await run(`codesign --sign - ${filePath}`);
	}
}

async function main() {
	await mkdir("sea", { recursive: true });
	await esbuild.build({
		entryPoints: ["dist/cmd.js"],
		bundle: true,
		platform: "node",
		outfile: "sea/bundle.js",
		external: [
			"pg",
			"oracledb",
			"sqlite3",
			"tedious",
			"pg-query-stream",
			"mysql2",
			"mysql",
			"better-sqlite3",
		],
	});

	// keeping things inline
	await writeFile(
		"sea/sea-config.json",
		JSON.stringify({
			main: "bundle.js",
			disableExperimentalSEAWarning: true,
			output: "sea/sea-prep.blob",
			assets: {
				"config.template.cjs": "./dist/config.template.cjs",
			},
		}),
	);

	await run("node --experimental-sea-config sea/sea-config.json");
	const blob = await readFile("sea/sea-prep.blob");
	await rm("sea/bundle.js");
	await rm("sea/sea-prep.blob");
	await rm("sea/sea-config.json");

	for (const platform of platforms) {
		await createBinary(blob, platform);
		console.log(chalk.green(`Done: ${platform.os} ${platform.arch}`));
	}
}

await main();
