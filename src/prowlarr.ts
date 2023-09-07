import fetch from 'node-fetch';
import { logger } from "./logger.js";
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

interface ValidatedFileConfig {
	prowlarrUrl: string;
	prowlarrApiKey: string;
	prowlarrTag: string;
}

function buildUrl(base: string, endpoint: string, apiKey: string): string {
	return `${base}/api/v1/${endpoint}?apikey=${apiKey}`;
}

async function fetchTagId(fileConfig: ValidatedFileConfig): Promise<number| null> {
	try {
		const response = await fetch(buildUrl(fileConfig.prowlarrUrl, 'tag', fileConfig.prowlarrApiKey));
		if (!response.ok) {
			logger.error('Prowlarr response was not ok ' + response.statusText);
			return null;
		}
		const tags: Tag[] = await response.json() as Tag[];
		logger.info(`Prowlarr: Found ${tags.length} tags from Prowlarr.`);

		return tags.find(tag => tag.label === fileConfig.prowlarrTag)?.id;
	} catch (error) {
		logger.error(`Prowlarr: Error fetching tag IDs: ${error}`);
		return null;
	}
}

export async function getProwlarrIndexers(): Promise<string[] | null> {
	try {
		const fileConfig = await getFileConfig();
		if (fileConfig.prowlarrUrl !== undefined &&
			fileConfig.prowlarrApiKey !== undefined &&
			fileConfig.prowlarrTag !== undefined) {

			try {
				const tagId = await fetchTagId(fileConfig as ValidatedFileConfig);

				if (tagId !== null) {
					const response = await fetch(buildUrl(fileConfig.prowlarrUrl, 'indexer', fileConfig.prowlarrApiKey));
					if (!response.ok) {
						logger.error('Prowlarr: Network response was not ok ' + response.statusText);
						return null;
					}
					const indexers: Indexer[] = await response.json() as Indexer[];
					const filteredIndexers = indexers.filter(indexer => {
						return indexer.enable && indexer.tags && indexer.tags.includes(tagId);
					});

					logger.info(`Prowlarr: Found ${filteredIndexers.length} enabled indexers with the specified tag`);

					return filteredIndexers.map(indexer => {
						return buildUrl(fileConfig.prowlarrUrl, `${indexer.id}/api`, fileConfig.prowlarrApiKey);
					});
				}
			} catch (error) {
				logger.error(`Prowlarr: An error occurred: ${error}`);
			}
		}
	} catch (error1) {
		logger.error(`Prowlarr: An error occurred: ${error1}`);
	}
}


