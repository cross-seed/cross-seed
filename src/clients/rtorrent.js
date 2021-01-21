const fs = require("fs").promises;
const path = require("path");
const { promisify } = require("util");
const xmlrpc = require("xmlrpc");
const bencode = require("bencode");
const parseTorrent = require("parse-torrent");
const chalk = require("chalk");
const { wait } = require("../utils");
const logger = require("../logger");
const { getRuntimeConfig } = require("../runtimeConfig");

async function createLibtorrentResumeTree(meta, dataDir) {
	async function getFileResumeData(file) {
		const filePath = path.resolve(dataDir, file.path);
		const fileStat = await fs
			.lstat(filePath)
			.catch(() => ({ isFile: () => false }));
		if (!fileStat.isFile() || fileStat.size !== file.length) {
			logger.error(
				chalk.red(
					`File ${filePath} either doesn't exist or is the wrong size.`
				)
			);
			return {
				completed: 0,
				mtime: 0,
				priority: 0,
			};
		}

		return {
			completed: Math.ceil(file.length / meta.pieceLength),
			mtime: Math.trunc(fileStat.mtimeMs / 1000),
			priority: 0,
		};
	}

	return {
		bitfield: Math.ceil(meta.length / meta.pieceLength),
		files: await Promise.all(meta.files.map(getFileResumeData)),
	};
}

async function saveWithLibtorrentResume(meta, savePath, dataDir) {
	const rawMeta = bencode.decode(parseTorrent.toTorrentFile(meta));
	rawMeta.libtorrent_resume = await createLibtorrentResumeTree(meta, dataDir);
	await fs.writeFile(savePath, bencode.encode(rawMeta));
}

function getClient() {
	const { rtorrentRpcUrl } = getRuntimeConfig();

	const { origin, username, password, protocol, pathname } = new URL(
		rtorrentRpcUrl
	);

	const clientCreator =
		protocol === "https:" ? xmlrpc.createSecureClient : xmlrpc.createClient;

	const shouldUseAuth = Boolean(username && password);

	const client = clientCreator({
		url: origin + pathname,
		basic_auth: shouldUseAuth
			? { user: username, pass: password }
			: undefined,
	});

	client.methodCallP = promisify(client.methodCall.bind(client));
	return client;
}

async function checkForInfoHashInClient(infoHash) {
	const client = getClient();
	const downloadList = await client.methodCallP("download_list", []);
	return downloadList.includes(infoHash.toUpperCase());
}

async function getDataDir(meta) {
	const infoHash = meta.infoHash.toUpperCase();
	const client = getClient();
	const [[isMultiFileStr], [dir]] = await client.methodCallP(
		"system.multicall",
		[
			[
				{
					methodName: "d.is_multi_file",
					params: [infoHash],
				},
				{
					methodName: "d.directory",
					params: [infoHash],
				},
			],
		]
	);
	return Number(isMultiFileStr) ? path.dirname(dir) : dir;
}

exports.inject = async function inject(meta, ogMeta) {
	const { outputDir } = getRuntimeConfig();

	const client = getClient();

	const dataDir = await getDataDir(ogMeta);
	const savePath = path.resolve(
		outputDir,
		`${meta.name}.tmp.${Date.now()}.torrent`
	);
	await saveWithLibtorrentResume(meta, savePath, dataDir);

	await client.methodCallP("load.start", [
		"",
		savePath,
		`d.directory.set="${dataDir}"`,
		`d.custom1.set="cross-seed"`,
		`d.custom.set=addtime,${Math.round(Date.now() / 1000)}`,
	]);

	for (let i = 0; i < 5; i++) {
		await wait(100 * Math.pow(2, i));
		if (await checkForInfoHashInClient(meta.infoHash)) {
			setTimeout(() => fs.unlink(savePath), 1000);
			return true;
		}
	}
	setTimeout(() => fs.unlink(savePath), 1000);
	return false;
};
