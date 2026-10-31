import { runOverlapScenario } from "./overlap.js";
import { runSchedulingScenario } from "./scheduling.js";
import { runScenario } from "./scenario.js";

const result = await runScenario((message) => console.log(`✓ ${message}`));
console.log(JSON.stringify(result, null, 2));

await runOverlapScenario((message) => console.log(`✓ ${message}`));
await runSchedulingScenario((message) => console.log(`✓ ${message}`));
