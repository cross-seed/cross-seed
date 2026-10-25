import { runScenario } from "./scenario.js";

const result = await runScenario((message) => console.log(`✓ ${message}`));
console.log(JSON.stringify(result, null, 2));
