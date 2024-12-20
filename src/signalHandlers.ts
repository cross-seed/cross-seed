import { db, memDB } from "./db.js";

async function exitGracefully() {
	await db.destroy();
	await memDB.destroy();
	process.exit();
}

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);
