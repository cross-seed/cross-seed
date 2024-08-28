import { File } from "../../src/searchee";

export const fileFactory = (overrides: Partial<File> = {}): File => {
	return {
		name: "media.mp4",
		length: 0,
		path: "/tmp/media.mp4",
		...overrides,
	};
};
