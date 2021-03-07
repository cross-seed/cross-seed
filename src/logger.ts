import { getRuntimeConfig }  from "./runtimeConfig";
import chalk from 'chalk';

export function log(...args) {
	console.log(...args);
}

export function verbose(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.log(...args);
	}
}

export function debug(...args) {
	const { verbose } = getRuntimeConfig();
	if (verbose) {
		console.error(...args);
	}
}

export function error(...args) {
	console.error(...args.map((arg) => chalk.red(arg)));
}

export function warn(...args) {
	console.warn(...args.map((arg) => chalk.yellow(arg)));
}
