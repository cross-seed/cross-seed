import { InjectionResult } from "../constants.js";
import { CrossSeedError } from "../errors.js";
import { Label, logger } from "../logger.js";
import { Metafile } from "../parseTorrent.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { Searchee } from "../searchee.js";
import { TorrentClient } from "./TorrentClient.js";
import fetch, { Headers, Response } from "node-fetch";
export default class Deluge implements TorrentClient {
	private msgId = 0;
	private loggedIn = false;
	private delugeCookie = "";
	private delugeWebUrl: URL;
	private delugeLabel: string;
	private isLabelEnabled: Promise<boolean>;
	private delugeRetries: number;

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
		let response = await this.call({
			params: [this.delugeWebUrl.password],
			method: "auth.login",
		});

		if (response === null) {
			throw new CrossSeedError(
				`failed to establish a connection to deluge: ${this.delugeWebUrl.origin}`
			);
		}

		if (response.data.result && response.headers.has("Set-Cookie")) {
			this.delugeCookie = response.headers
				.get("Set-Cookie")
				.split(";")[0];
			this.loggedIn = true;
			return;
		}
		throw new CrossSeedError(
			`failed to authenticate the session in deluge: ${this.delugeWebUrl.origin}`
		);
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 */
	private async sendCall(method: string, params: any[]) {
		let response;
		response = await this.call({
			params: params,
			method,
		});

		if (response.code == 1) {
			await this.authenticate();
			response = await this.call({
				params: params,
				method,
			});
		}
		return response && response.data && response.data.error === null
			? response.data
			: response.data.error;
	}

	private async call(body: { method: string; params: any[] }) {
		this.msgId = (this.msgId + 1) % 1024;

		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		const url = this.delugeWebUrl.origin + this.delugeWebUrl.pathname;
		let response: Response;
		try {
			response = await fetch(url, {
				body: JSON.stringify({ ...body, msgId: this.msgId }),
				method: "POST",
				headers: headers,
			});
		} catch (networkError) {
			return null;
		}

		if (!response.ok) {
			return null;
		}
		return { ...response, data: (await response.json()) as any };
	}

	/**
	 * lists plugins and adds/sets labels
	 * returns true if successful.
	 */
	private async labelEnabled() {
		const enabledLabels = await this.sendCall(
			"core.get_enabled_plugins",
			[]
		);
		return enabledLabels.result && enabledLabels.result.includes("Label");
	}
	private async setLabel(infoHash: string): Promise<void> {
		if (this.isLabelEnabled) {
			const setResult = await this.sendCall("label.set_torrent", [
				infoHash,
				this.delugeLabel,
			]);
			if (setResult.code && setResult.code == 4) {
				await this.sendCall("label.add", [this.delugeLabel]);
				await this.sendCall("label.set_torrent", [
					infoHash,
					this.delugeLabel,
				]);
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
		const addResult = await this.sendCall("core.add_torrent_file", params);
		if (addResult.result) {
			this.setLabel(newTorrent.infoHash);
			return InjectionResult.SUCCESS;
		}
		if (addResult.message && addResult.message.includes("already")) {
			return InjectionResult.ALREADY_EXISTS;
		} else {
			logger.debug({
				label: Label.DELUGE,
				message: `injection failed: ${addResult.message}`,
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
			const params = [
				["name", "state", "save_path"],
				{ hash: searchee.infoHash },
			];
			const response = await this.sendCall("web.update_ui", params);

			return (
				response.result.torrents[searchee.infoHash].state === "Seeding"
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
