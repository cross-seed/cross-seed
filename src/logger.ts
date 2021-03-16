import chalk from "chalk";
import { getRuntimeConfig } from "./runtimeConfig";

export function log(...args: unknown[]): void {
	console.log(...args);
}

export function verbose(...args: unknown[]): void {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.log(...args);
	}
}

export function debug(...args: unknown[]): void {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.error(...args);
	}
}

export function error(...args: string[]): void {
	console.error(...args.map((arg) => chalk.red(arg)));
}

export function warn(...args: string[]): void {
	console.warn(...args.map((arg) => chalk.yellow(arg)));
}
