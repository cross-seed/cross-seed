import Knex from "knex";
import { Model } from "objection";
import { createAppDir } from "./configuration.js";
import knexfile from "./knexfile.js";

createAppDir();

// // table of searchees
// searchee
// id int pk
// first_searched int
// last_searched int
// info_hash char(20?)

export class SearcheeModel extends Model {
	static tableName = "searchee";
}

// // decision cache
// decision
// id int pk
// first_seen int
// last_seen int
// info_hash int
//

class DecisionModel extends Model {
	static tableName = "decision";
}
// // torrent cache so as not to thrash reads in daemon mode
// torrent
// file_path varchar(1024)
// info_hash varchar(256)
// name

class TorrentModel extends Model {
	static tableName = "torrent";
}

export const knex = Knex.knex(knexfile);
Model.knex(knex);
