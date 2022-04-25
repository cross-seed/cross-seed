import Knex from "knex";
import knexfile from "./knexfile.js";
export const knex = Knex.knex(knexfile);
