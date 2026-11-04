import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { Worker } from "node:worker_threads";

type ChangeListener = (filename: string | null) => void;

export class DataDirWatcher extends EventEmitter {
	closed = false;
	private closing?: Promise<void>;

	constructor(
		readonly ready: Promise<void>,
		private readonly stop: () => Promise<void>,
		private readonly cancelReady: () => void = () => {},
	) {
		super();
		// Errors are also emitted for the lifecycle owner. Observe the readiness
		// rejection immediately, including if the owner closes before awaiting it.
		void ready.catch(() => {});
	}

	close(): Promise<void> {
		if (!this.closing) {
			this.closed = true;
			this.cancelReady();
			this.closing = this.stop();
		}
		return this.closing;
	}
}

// Keep the worker self-contained: standalone executables have no adjacent JS
// worker file. Only built-ins and workerData are needed inside this isolate.
const workerSource = `
const { watch } = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');
const watcher = watch(workerData, { recursive: true, persistent: false }, (_, filename) => {
  parentPort.postMessage({ type: 'change', filename: filename === null ? null : String(filename) });
});
watcher.on('error', error => { throw error; });
// Keep this worker alive, while the owner unrefs it after readiness so it does
// not keep a completed CLI invocation alive.
parentPort.on('message', () => {});
parentPort.postMessage({ type: 'ready' });
`;

/** Contain Linux recursive fs.watch callback exceptions (nodejs/node#66791). */
export function watchDataDirInWorker(
	dataDir: string,
	onChange: ChangeListener,
): DataDirWatcher {
	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const worker = new Worker(workerSource, {
		eval: true,
		workerData: dataDir,
		execArgv: [],
	});
	const watcher = new DataDirWatcher(
		ready,
		async () => {
			await worker.terminate();
		},
		() => rejectReady(new Error("Filesystem watcher closed before ready")),
	);
	let failed = false;
	worker.on(
		"message",
		(
			message:
				| { type: "ready" }
				| { type: "change"; filename: string | null },
		) => {
			if (watcher.closed) return;
			if (message.type === "ready") {
				resolveReady();
				worker.unref();
			} else onChange(message.filename);
		},
	);
	worker.on("error", (error: Error) => {
		if (watcher.closed) return;
		failed = true;
		rejectReady(error);
		watcher.emit("error", error);
	});
	worker.on("exit", (code) => {
		if (watcher.closed || failed) return;
		const error = new Error(`Filesystem watcher worker exited (${code})`);
		rejectReady(error);
		watcher.emit("error", error);
	});
	return watcher;
}

export function watchDataDir(
	dataDir: string,
	onChange: ChangeListener,
): DataDirWatcher {
	if (process.platform === "linux")
		return watchDataDirInWorker(dataDir, onChange);
	const native = watch(
		dataDir,
		{ recursive: true, persistent: false },
		(_, filename) => onChange(filename),
	);
	const watcher = new DataDirWatcher(Promise.resolve(), () => {
		native.close();
		return Promise.resolve();
	});
	native.on("error", (error) => {
		if (!watcher.closed) watcher.emit("error", error);
	});
	return watcher;
}
