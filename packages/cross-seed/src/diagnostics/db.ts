import { stat } from "fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { appDir } from "../configuration.js";

export interface DbDiagnostics {
	path: string;
	sizes: {
		db: number | null;
		wal: number | null;
		shm: number | null;
	};
	pageSize: number | null;
	pageCount: number | null;
	freelistCount: number | null;
	freeBytes: number | null;
	freePercent: number | null;
	dbstatTop?: { name: string; bytes: number; pages: number }[];
	dbstatError?: string;
	error?: string;
}

async function statBytes(path: string): Promise<number | null> {
	try {
		return (await stat(path)).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function collectDbDiagnostics(): Promise<DbDiagnostics> {
	const dbPath = join(appDir(), "cross-seed.db");
	const walPath = `${dbPath}-wal`;
	const shmPath = `${dbPath}-shm`;
	try {
		const [dbBytes, walBytes, shmBytes] = await Promise.all([
			statBytes(dbPath),
			statBytes(walPath),
			statBytes(shmPath),
		]);

		const diagnostics: DbDiagnostics = {
			path: dbPath,
			sizes: { db: dbBytes, wal: walBytes, shm: shmBytes },
			pageSize: null,
			pageCount: null,
			freelistCount: null,
			freeBytes: null,
			freePercent: null,
		};

		if (dbBytes === null) return diagnostics;

		let sqlite: DatabaseSync | null = null;
		try {
			sqlite = new DatabaseSync(dbPath, {
				readOnly: true,
			});
			const pageSizeRow = sqlite
				.prepare("PRAGMA page_size")
				.get() as { page_size?: number } | undefined;
			const pageCountRow = sqlite
				.prepare("PRAGMA page_count")
				.get() as { page_count?: number } | undefined;
			const freelistCountRow = sqlite
				.prepare("PRAGMA freelist_count")
				.get() as { freelist_count?: number } | undefined;
			const pageSize =
				typeof pageSizeRow?.page_size === "number"
					? pageSizeRow.page_size
					: null;
			const pageCount =
				typeof pageCountRow?.page_count === "number"
					? pageCountRow.page_count
					: null;
			const freelistCount =
				typeof freelistCountRow?.freelist_count === "number"
					? freelistCountRow.freelist_count
					: null;

			diagnostics.pageSize = pageSize;
			diagnostics.pageCount = pageCount;
			diagnostics.freelistCount = freelistCount;

			if (pageSize !== null && freelistCount !== null) {
				diagnostics.freeBytes = pageSize * freelistCount;
			}

			if (pageSize && pageCount && diagnostics.freeBytes !== null) {
				const totalBytes = pageSize * pageCount;
				if (totalBytes > 0) {
					diagnostics.freePercent =
						(diagnostics.freeBytes / totalBytes) * 100;
				}
			}

			try {
				const dbstatRows = sqlite
					.prepare(
						`SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages
						FROM dbstat
						GROUP BY name
						ORDER BY bytes DESC
						LIMIT 10`,
					)
					.all() as { name: string; bytes: number; pages: number }[];
				diagnostics.dbstatTop = dbstatRows;
			} catch (error) {
				diagnostics.dbstatError =
					error instanceof Error
						? error.message
						: String(error ?? "");
			}
		} catch (error) {
			diagnostics.error =
				error instanceof Error ? error.message : String(error ?? "");
		} finally {
			sqlite?.close();
		}

		return diagnostics;
	} catch (error) {
		return {
			path: dbPath,
			sizes: { db: null, wal: null, shm: null },
			pageSize: null,
			pageCount: null,
			freelistCount: null,
			freeBytes: null,
			freePercent: null,
			error: error instanceof Error ? error.message : String(error ?? ""),
		};
	}
}
