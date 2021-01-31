const { validateJackettApi } = require("./jackett");

exports.doStartupValidation = async function doStartupValidation() {
	validateJackettApi();
};
