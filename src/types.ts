interface FileListing {
	path: string;
	pathSegments?: string[];
	name: string;
	length: number;
	offset: number;
}

export interface Metafile {
	infoHash: string;
	info: {
		length: number;
		name: Buffer;
		"piece length": number;
		pieces: Buffer;
		private: 0 | 1;
	};
	infoBuffer: Buffer;
	name: string;
	private: boolean;
	created: Date;
	createdBy?: string;
	comment?: string;
	announce: string[];
	files: FileListing[];
	length: number;
	pieceLength: number;
	lastPieceLength: number;
	pieces: string[];
}
