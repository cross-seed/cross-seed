import * as esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["dist/cmd.js"],
	bundle: true,
	platform: "node",
	outfile: "out.js",
});
