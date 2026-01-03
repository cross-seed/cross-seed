// .husky/install.mjs
import { existsSync } from "node:fs";

if (
	process.env.NODE_ENV === "production" ||
	process.env.CI === "true" ||
	existsSync("/.dockerenv")
) {
	process.exit(0);
}

const husky = (await import("husky")).default;
console.log(husky());
