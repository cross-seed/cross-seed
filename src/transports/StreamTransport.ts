import Transport from "winston-transport";

export interface LogStreamEvent {
	timestamp: string;
	level: string;
	label?: string;
	message: string;
}

class StreamTransport extends Transport {
	private subscribers = new Set<(log: LogStreamEvent) => void>();

	constructor(opts?: Transport.TransportStreamOptions) {
		super(opts);
	}

	log(info: unknown, callback: () => void) {
		const logInfo = info as Record<string, unknown>;
		const logEvent: LogStreamEvent = {
			timestamp: logInfo.timestamp as string,
			level: logInfo.level as string,
			label: logInfo.label as string,
			message: logInfo.message as string,
		};

		// Notify all subscribers
		this.subscribers.forEach((callback) => callback(logEvent));
		callback();
	}

	subscribe(callback: (log: LogStreamEvent) => void) {
		this.subscribers.add(callback);
		return () => this.subscribers.delete(callback);
	}
}

export { StreamTransport };
