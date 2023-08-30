import axios from 'axios';
import { getFileConfig } from "./configuration.js";

export function getProwlarrIndexers() {
	return getFileConfig()
		.then(fileConfig => {
			if (fileConfig.prowlarrUrl != undefined &&
				fileConfig.prowlarrApiKey != undefined &&
				fileConfig.prowlarrTag != undefined) {

				return axios.get(`${fileConfig.prowlarrUrl}/api/v1/indexer?apikey=${fileConfig.prowlarrApiKey}`)
					.then(response => {
						const indexers = response.data;
						const filteredIndexers = indexers.filter(indexer => {
							return indexer.tags && indexer.tags.includes(fileConfig.prowlarrTag);
						});

						return filteredIndexers.map(indexer => {
							return `${fileConfig.prowlarrUrl}/${indexer.id}/?apiKey=${fileConfig.prowlarrApiKey}`;
						});
					});
			} else {
				/* do nothing */
			}
		})
		.catch(error => {
			console.error(`An error occurred: ${error}`);
		});
}


