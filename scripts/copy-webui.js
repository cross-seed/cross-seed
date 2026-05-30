import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const crossSeedDist = join(repoRoot, "cross-seed/dist");
const webuiDest = join(crossSeedDist, "webui");
const webuiSource = join(repoRoot, "webui/dist");

await rm(webuiDest, { recursive: true, force: true });
await mkdir(crossSeedDist, { recursive: true });
await cp(webuiSource, webuiDest, { recursive: true });
