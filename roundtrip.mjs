import parseTorrent from 'parse-torrent';
import {readFileSync} from 'fs';
const x = parseTorrent(readFileSync(0));
parseTorrent(parseTorrent.toTorrentFile(x));