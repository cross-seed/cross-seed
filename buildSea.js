import * as esbuild from "esbuild";
import { exec } from "node:child_process";
import { inject } from "postject";
import { readFile, writeFile } from "fs/promises";
import chalk from "chalk";
import { rm } from "node:fs/promises";

async function run(cmd) {
	const { promise, resolve, reject } = Promise.withResolvers();

	console.log(chalk.bold(`Running: ${cmd}`));
	const proc = exec(cmd, { encoding: "utf8" }, (err, data) => {
		if (err) reject(err);
		resolve(data);
	});
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
	await promise;
	console.log(chalk.green("Done"));
}

await esbuild.build({
	entryPoints: ["dist/cmd.js"],
	bundle: true,
	platform: "node",
	outfile: "bundle.js",
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
	"sea-config.json",
	JSON.stringify({
		main: "bundle.js",
		disableExperimentalSEAWarning: true,
		output: "sea-prep.blob",
		assets: {
			"config.template.cjs": "./dist/config.template.cjs",
		},
	}),
);
await run("node --experimental-sea-config sea-config.json");
const blob = await readFile("sea-prep.blob");
await run("cp $(which node) cross-seed-sea");
await run("codesign --remove-signature cross-seed-sea");
inject("cross-seed-sea", "NODE_SEA_BLOB", blob, {
	sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
	machoSegmentName: "NODE_SEA",
});

await run("codesign --sign - cross-seed-sea");
await rm("sea-prep.blob");
await rm("sea-config.json");
