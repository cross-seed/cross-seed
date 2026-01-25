import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const pkgDir = path.join(rootDir, "packages", "cross-seed");
const nodeModulesDir = path.join(pkgDir, "node_modules");

const bundles = [
	{
		name: "@cross-seed/shared",
		src: path.join(rootDir, "packages", "shared"),
	},
	{
		name: "webui",
		src: path.join(rootDir, "packages", "webui"),
		stripDependencies: true,
	},
];

const packageDirForName = (name) => {
	if (name.startsWith("@")) {
		const [scope, pkg] = name.split("/");
		return path.join(nodeModulesDir, scope, pkg);
	}
	return path.join(nodeModulesDir, name);
};

for (const bundle of bundles) {
	const distDir = path.join(bundle.src, "dist");
	if (!fs.existsSync(distDir)) {
		console.error(
			`Missing ${bundle.name} build output at ${distDir}. Run npm run build first.`,
		);
		process.exit(1);
	}

	const destDir = packageDirForName(bundle.name);
	fs.rmSync(destDir, { recursive: true, force: true });
	fs.mkdirSync(destDir, { recursive: true });

	const packageJsonPath = path.join(bundle.src, "package.json");
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	if (bundle.stripDependencies) {
		delete packageJson.dependencies;
		delete packageJson.devDependencies;
		delete packageJson.peerDependencies;
		delete packageJson.optionalDependencies;
	}
	fs.writeFileSync(
		path.join(destDir, "package.json"),
		`${JSON.stringify(packageJson, null, 2)}\n`,
	);
	fs.cpSync(distDir, path.join(destDir, "dist"), { recursive: true });
}
