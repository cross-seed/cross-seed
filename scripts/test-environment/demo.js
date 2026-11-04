import { runOverlapScenario } from "./overlap.js";
import { runSchedulingScenario } from "./scheduling.js";
import { runScenario } from "./scenario.js";
import { runStartupScenario } from "./startup.js";
import { runWatcherScenario } from "./watcher.js";

const result = await runScenario((message) => console.log(`✓ ${message}`));
console.log(JSON.stringify(result, null, 2));

await runOverlapScenario((message) => console.log(`✓ ${message}`));
await runSchedulingScenario((message) => console.log(`✓ ${message}`));
await runStartupScenario((message) => console.log(`✓ ${message}`));
if (process.platform === "linux" && process.getuid?.() !== 0) {
	await runWatcherScenario((message) => console.log(`✓ ${message}`));
}
