import { getRuntimeConfig } from "../runtimeConfig";
import { TorrentClient } from "./TorrentClient";

export default class QBittorrent implements TorrentClient {
	constructor() {
		const {
			qBittorrentUrl = "http://admin:adminadmin@localhost:8080",
		} = getRuntimeConfig();
		const { origin, username, password, protocol, pathname } = new URL(
			qBittorrentUrl
		);
	}
}
