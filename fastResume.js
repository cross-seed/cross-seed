"use strict";

const fs = require("fs");
const b = require("bencode");
const path = require("path");

const add_fast_resume = (meta, basepath) => {
	let files = [];
	let fpath = path.join(basepath, meta.info.name.toString("utf8"));
	if ("files" in meta.info) {
		for (let file of meta.info.files) {
			let ffpath = fpath;
			for (let dir of file.path) {
				ffpath = path.join(ffpath, dir.toString("utf8"));
			}
			let obj = { path: ffpath, size: file.length };
			files.push(obj);
		}
	} else {
		let obj = {};
		obj.path = fpath;
		obj.size = meta.info.length;
		files.push(obj);
	}

	let resume = {};
	resume.bitfield = Math.floor(meta.info.pieces.length / 20);
	resume.files = [];
	let piece_length = meta.info["piece length"];
	let offset = 0;

	for (let file of files) {
		try {
			let states = fs.statSync(file.path);
			if (states.size != file.size) {
				throw new Error("Files not matching!");
			}
			let obj = {};
			obj.priority = 1;
			obj.mtime = Math.floor(states.mtimeMs / 1000);
			obj.completed =
				Math.floor(
					(offset + file.size + piece_length - 1) / piece_length
				) - Math.floor(offset / piece_length);
			resume.files.push(obj);
			offset += file.size;
		} catch (err) {
			throw new Error("Files not matching!");
		}
	}
	meta.libtorrent_resume = resume;
	return meta;
};

module.exports = add_fast_resume;
