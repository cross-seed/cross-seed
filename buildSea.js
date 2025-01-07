import * as esbuild from "esbuild";

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
	],
});
