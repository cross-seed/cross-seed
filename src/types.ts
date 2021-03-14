import ParseTorrent from "parse-torrent";

export type Metafile = ParseTorrent.Instance;

export interface JackettResult {
	Author: unknown;
	BlackholeLink: string;
	BookTitle: unknown;
	Category: number[];
	CategoryDesc: string;
	Description: unknown;
	Details: string;
	DownloadVolumeFactor: number;
	Files: number;
	FirstSeen: string;
	Gain: number;
	Grabs: number;
	Guid: string;
	Imdb: unknown;
	InfoHash: unknown;
	Link: string;
	MagnetUri: unknown;
	MinimumRatio: number;
	MinimumSeedTime: number;
	Peers: number;
	Poster: unknown;
	PublishDate: string;
	RageID: unknown;
	Seeders: number;
	Size: number;
	TMDb: unknown;
	TVDBId: unknown;
	Title: string;
	Tracker: string;
	TrackerId: string;
	UploadVolumeFactor: number;
}

export interface ResultAssessment {
	tracker: string;
	tag: string;
	info: Metafile;
}
