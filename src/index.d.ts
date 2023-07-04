/* eslint-disable no-unused-vars */

declare module "parse-torrent" {
	export = ParseTorrent;
	function ParseTorrent(torrentId: Buffer): ParseTorrent.Metafile;
	namespace ParseTorrent {}
}
