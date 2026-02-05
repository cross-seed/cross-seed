import { router, unauthedProcedure } from "../index.js";
import { BUILD_INFO } from "../../buildInfo.js";
import { PROGRAM_NAME, PROGRAM_VERSION } from "../../constants.js";

export const metaRouter = router({
	getBuildInfo: unauthedProcedure.query(() => {
		return {
			appName: PROGRAM_NAME,
			version: PROGRAM_VERSION,
			build: BUILD_INFO,
		};
	}),
});
