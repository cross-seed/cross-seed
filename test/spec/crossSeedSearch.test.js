jest.mock("../../src/logger");
const logger = require("../../src/logger");
const { run } = require("../../src/cmd");

describe("cross-seed search", () => {
	beforeEach(() => {
		process.argv = ["node", "cross-seed", "search"];
	});
	it("", async () => {
		await run();
		expect(logger).toMatchSnapshot();
	});
});
