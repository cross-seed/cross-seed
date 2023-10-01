import { InjectionResult } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";
import fetch, { Headers, Response } from "node-fetch";

interface DelugeResponse {
	error?: {
		message?: string;
		code?: number;
	};
	result?: any;
}

export default class Deluge implements TorrentClient {
	private msgId = 0;
	private delugeCookie = "";
	private delugeWebUrl: URL;
	private delugeLabel: string;
	private isLabelEnabled: Promise<boolean>;

	constructor() {
		this.delugeWebUrl = new URL(`${getRuntimeConfig().delugeWebUrl}`);
		this.delugeLabel = "cross-seed";
	}

	/**
	 * validates the login and host for deluge webui
	 */
	async validateConfig(): Promise<void> {
		const url = new URL(this.delugeWebUrl);
		if (url.username && !url.password) {
			throw new CrossSeedError(
				"you need to define a password in the delugeWebUrl. (eg: http://:<PASSWORD>@localhost:8112)"
			);
		}
		await this.authenticate();
		this.isLabelEnabled = this.labelEnabled();
	}

	/**
	 * connects and authenticates to the webui
	 */
	private async authenticate(): Promise<void> {
		const response = await this.call({
			method: "auth.login",
			params: [this.delugeWebUrl.password],
		});

		if (response === null) {
			throw new CrossSeedError(
				`failed to establish a connection to deluge: ${this.delugeWebUrl.origin}`
			);
		}
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 */
	private async call(body: { method: string; params: any[] }) {
		this.msgId = (this.msgId + 1) % 1024;

		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		const url = this.delugeWebUrl.origin + this.delugeWebUrl.pathname;
		let response: Response, json: DelugeResponse;
		try {
			response = await fetch(url, {
				body: JSON.stringify({ ...body, id: this.msgId }),
				method: "POST",
				headers: headers,
			});
			json = (await response.json()) as DelugeResponse;
		} catch (networkError) {
			return null;
		}

		if (json && json.error && json.error.code && json.error.code === 1) {
			await this.authenticate();
			try {
				response = await fetch(url, {
					body: JSON.stringify({ ...body, id: this.msgId }),
					method: "POST",
					headers: headers,
				});
			} catch (networkError) {
				return null;
			}
			json = (await response.json()) as DelugeResponse;
		}
		if (!response.ok) {
			return null;
		}

		if (response.headers && response.headers.has("Set-Cookie")) {
			this.delugeCookie = response.headers
				.get("Set-Cookie")
				.split(";")[0];
		} else if (body.method == "auth.login") {
			throw new CrossSeedError(
				`failed to authenticate the session in deluge: ${this.delugeWebUrl.origin}`
			);
		}
		return json;
	}

	/**
	 * checks enabled plugins for "Label"
	 * returns true if successful.
	 */
	private async labelEnabled() {
		const enabledLabels = await this.call({
			method: "core.get_enabled_plugins",
			params: [],
		});
		return enabledLabels.result && enabledLabels.result.includes("Label");
	}

	/**
	 * if Label plugin is loaded, adds (if necessary)
	 * and sets the label based on torrent hash.
	 */
	private async setLabel(infoHash: string): Promise<void> {
		if (this.isLabelEnabled) {
			const setResult = await this.call({
				method: "label.set_torrent",
				params: [infoHash, this.delugeLabel],
			});
			if (
				setResult.error &&
				setResult.error.code &&
				setResult.error.code == 4
			) {
				await this.call({
					method: "label.add",
					params: [this.delugeLabel],
				});
				await this.call({
					method: "label.set_torrent",
					params: [infoHash, this.delugeLabel],
				});
			}
		}
	}

	/**
	 * injects a torrent into deluge client
	 */
	async inject(
		newTorrent: Metafile,
		searchee: Searchee,
		path?: string
	): Promise<InjectionResult> {
		if (searchee.infoHash && !(await this.checkCompleted(searchee))) {
			return InjectionResult.TORRENT_NOT_COMPLETE;
		}
		const params = this.formatData(
			`${newTorrent.name}.cross-seed.torrent`,
			newTorrent.encode().toString("base64"),
			path
		);
		const addResult = await this.call({
			method: "core.add_torrent_file",
			params: params,
		});
		if (addResult.result) {
			this.setLabel(newTorrent.infoHash);
			return InjectionResult.SUCCESS;
		} else if (
			addResult.error &&
			addResult.error.message &&
			addResult.error.message.includes("already")
		) {
			return InjectionResult.ALREADY_EXISTS;
		} else if (addResult.error && addResult.error.message) {
			logger.debug({
				label: Label.DELUGE,
				message: `injection failed: ${addResult.error.message}`,
			});
			return InjectionResult.FAILURE;
		}
	}

	/**
	 * formats the json for rpc calls to inject
	 */
	private formatData(filename: string, filedump: string, path: string) {
		return [
			filename,
			filedump,
			{
				add_paused: false,
				seed_mode: getRuntimeConfig().skipRecheck,
				download_location: path,
			},
		];
	}

	/**
	 * returns true if the torrent hash is Seeding (completed)
	 */
	async checkCompleted(searchee: Searchee): Promise<boolean> {
		try {
			const params = [["state", "progress"], { hash: searchee.infoHash }];

			const response = await this.call({
				method: "web.update_ui",
				params: params,
			});
			return (
				response.result &&
				response.result.torrents &&
				(response.result.torrents[searchee.infoHash].state ===
					"Seeding" ||
					(response.result.torrents[searchee.infoHash].state ===
						"Paused" &&
						response.result.torrents[searchee.infoHash].progress ===
							100))
			);
		} catch (e) {
			logger.debug({
				label: Label.DELUGE,
				message: `failed to fetch torrent state: ${searchee.name} - ${searchee.infoHash}`,
			});
		}
		return false;
	}
}
