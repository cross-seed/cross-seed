"use strict";

const fs = require("fs");
const path = require("path");

const add_fast_resume = (meta, basepath) => {
	const { info } = meta;
	const { name, files: metaFiles } = info;
	let files;
	let topLevelPath = path.join(basepath, name.toString("utf8"));
	if (metaFiles) {
		// for each file, joins together all path segments into one path
		// after converting segments from binary
		files = metaFiles.map((file) => ({
			path: path.join(
				topLevelPath,
				...file.path.map((seg) => seg.toString("utf8"))
			),
			size: file.length,
		}));
	} else {
		files = [{ path: topLevelPath, size: meta.info.length }];
	}

	let resume = {
		bitfield: Math.floor(meta.info.pieces.length / 20),
		files: [],
	};
	let pieceLength = meta.info["piece length"];
	let offset = 0;

	for (let file of files) {
		let states = fs.statSync(file.path);
		if (states.size !== file.size) {
			throw new Error("Files not matching!");
		}
		const completed =
			Math.floor((offset + file.size + pieceLength - 1) / pieceLength) -
			Math.floor(offset / pieceLength);
		let obj = {
			priority: 1,
			mtime: Math.floor(states.mtimeMs / 1000),
			completed,
		};

		resume.files.push(obj);
		offset += file.size;
	}
	meta.libtorrent_resume = resume;
	return meta;
};

module.exports = add_fast_resume;
