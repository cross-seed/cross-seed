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
	result?: string | boolean;
}

export default class Deluge implements TorrentClient {
	private msgId = 0;
	private delugeCookie = "";
	private delugeRpcUrl: URL;
	private delugeLabel: string;
	private isLabelEnabled: boolean;

	constructor() {
		const { delugeRpcUrl } = getRuntimeConfig();
		this.delugeRpcUrl = new URL(delugeRpcUrl);
		this.delugeLabel = "cross-seed";
	}

	/**
	 * validates the login and host for deluge webui
	 */
	async validateConfig(): Promise<void> {
		if (!this.delugeRpcUrl.password) {
			throw new CrossSeedError(
				"you need to define a password in the delugeRpcUrl. (eg: http://:<PASSWORD>@localhost:8112)"
			);
		}
		await this.authenticate();
		this.isLabelEnabled = await this.labelEnabled();
	}

	/**
	 * connects and authenticates to the webui
	 */
	private async authenticate(): Promise<void> {
		const response = await this.call("auth.login", [
			this.delugeRpcUrl.password,
		]);
		if (response === null) {
			throw new CrossSeedError(
				`failed to establish a connection to deluge: ${this.delugeRpcUrl.origin}`
			);
		}
		if (!response.result) {
			throw new CrossSeedError(
				`failed to authenticate with deluge: ${this.delugeRpcUrl.origin}`
			);
		}
	}

	/**
	 * ensures authentication and sends JSON-RPC calls to deluge
	 */
	private async call(method: string, params: object, retries = 1) {
		this.msgId = (this.msgId + 1) % 1024;
		const url = this.delugeRpcUrl.origin + this.delugeRpcUrl.pathname;

		const headers = new Headers({ "Content-Type": "application/json" });
		if (this.delugeCookie) headers.set("Cookie", this.delugeCookie);

		let response: Response, json: DelugeResponse;
		try {
			response = await fetch(url, {
				body: JSON.stringify({
					...{ method: method, params: params },
					id: this.msgId,
				}),
				method: "POST",
				headers: headers,
			});
			json = (await response.json()) as DelugeResponse;
		} catch (networkError) {
			return null;
		}
		if (json?.error?.code === 1 && retries > 0) {
			await this.authenticate();
			return this.call(method, params, 0);
		}
		if (!response.ok) {
			return null;
		}
		this.handleResponseHeaders(response.headers);

		return json;
	}

	/**
	 * parses the set-cookie header and updates stored value
	 */
	private handleResponseHeaders(headers: Headers) {
		if (headers?.has("Set-Cookie")) {
			this.delugeCookie = headers.get("Set-Cookie").split(";")[0];
			return true;
		}
		return false;
	}

	/**
	 * checks enabled plugins for "Label"
	 * returns true if successful.
	 */
	private async labelEnabled() {
		const enabledLabels = await this.call("core.get_enabled_plugins", []);
		return enabledLabels?.result?.includes("Label");
	}

	/**
	 * if Label plugin is loaded, adds (if necessary)
	 * and sets the label based on torrent hash.
	 */
	private async setLabel(infoHash: string): Promise<void> {
		if (this.isLabelEnabled) {
			const setResult = await this.call("label.set_torrent", [
				infoHash,
				this.delugeLabel,
			]);
			if (setResult?.error?.code == 4) {
				await this.call("label.add", [this.delugeLabel]);
				await this.call("label.set_torrent", [
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
			path ? path : await this.getSavePath(searchee)
		);
		const addResult = await this.call("core.add_torrent_file", params);
		if (addResult.result) {
			this.setLabel(newTorrent.infoHash);
			return InjectionResult.SUCCESS;
		} else if (addResult?.error?.message?.includes("already")) {
			return InjectionResult.ALREADY_EXISTS;
		} else if (addResult?.error?.message) {
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
	 * returns true if the torrent hash is completed in deluge
	 */
	private async getSavePath(searchee: Searchee): Promise<string> {
		try {
			const params = [["save_path"], { hash: searchee.infoHash }];

			const response = await this.call("web.update_ui", params);
			return response?.result?.torrents?.[searchee.infoHash]?.save_path;
		} catch (e) {
			logger.debug({
				label: Label.DELUGE,
				message: `failed to fetch torrent save_path: ${searchee.name} - ${searchee.infoHash}`,
			});
		}
		return null;
	}

	/**
	 * returns true if the torrent hash is Seeding (completed)
	 */
	private async checkCompleted(searchee: Searchee): Promise<boolean> {
		try {
			const params = [["state", "progress"], { hash: searchee.infoHash }];

			const response = await this.call("web.update_ui", params);
			return (
				response?.result?.torrents?.[searchee.infoHash]?.state ===
					"Seeding" ||
				response?.result?.torrents?.[searchee.infoHash]?.progress ===
					100
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
