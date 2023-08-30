import axios from 'axios';
import { getFileConfig } from "./configuration.js";

interface Indexer {
	definitionName: string;
	name: string;
	tags: number[];
	id: number;
	enable: boolean;
}

interface Tag {
	id: number;
	label: string;
}

async function fetchTagId(fileConfig): Promise<number| null> {
	try {
		const response = await axios.get(`${fileConfig.prowlarrUrl}/api/v1/tag?apikey=${fileConfig.prowlarrApiKey}`);
		const tags: Tag[] = response.data as Tag[];

		const tagObj = tags.find(tag => tag.label === fileConfig.prowlarrTag);
		return tagObj ? tagObj.id : null;
	} catch (error) {
		console.error(`Error fetching tag IDs from Prowlarr: ${error}`);
		return null;
	}
}

export async function getProwlarrIndexers(): Promise<string[] | void> {
	try {
		const fileConfig = await getFileConfig();
		if (fileConfig.prowlarrUrl !== undefined &&
			fileConfig.prowlarrApiKey !== undefined &&
			fileConfig.prowlarrTag !== undefined) {

			try {
				const tagId = await fetchTagId(fileConfig);
				const response = await axios.get(`${fileConfig.prowlarrUrl}/api/v1/indexer?apikey=${fileConfig.prowlarrApiKey}`);
				const indexers:  Indexer[] = response.data as Indexer[];

				if (tagId !== null) {
					const filteredIndexers = indexers.filter(indexer => {
						return indexer.enable && indexer.tags && indexer.tags.includes(tagId);
					});

					return filteredIndexers.map(indexer => {
						return `${fileConfig.prowlarrUrl}/${indexer.id}/?apiKey=${fileConfig.prowlarrApiKey}`;
					});
				}
			} catch (error) {
				console.error(`An error occurred: ${error}`);
			}
		} else {
			/* do nothing */
		}
	} catch (error1) {
		console.error(`An error occurred: ${error1}`);
	}
}


