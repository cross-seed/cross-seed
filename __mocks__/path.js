"use strict";

const path = jest.createMockFromModule("path");

// A custom version of `readdirSync` that reads from the special mocked out
// file list set via __setMockFiles
function join(...args) {
	return args.join("/");
}

path.join = join;

module.exports = path;
