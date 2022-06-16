# Breaking changes you'll need to migrate

| Change                                | Location           | Old                                    | New                                                                                                                           | Notes                                                                                                                                                                                        |
| ------------------------------------- | ------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `excludeOlder` format                 | Configuration file | `excludeOlder: 10,`                    | `excludeOlder: "10 minutes",`                                                                                                 |
| `-x`/`--exclude-older` format         | CLI arguments      | `-x 10`/`--exclude-older 10`           | `-x 10min`/`--exclude-older 10min`                                                                                            |
| `excludeRecentSearch` format          | Configuration file | `excludeRecentSearch: 10,`             | `excludeRecentSearch: "10 minutes",`                                                                                          |
| `-r`/`--exclude-recent-search` format | CLI arguments      | `-r 10`/`--exclude-recent-search 10`   | `-r 10min`/`--exclude-recent-search 10min`                                                                                    |
| `offset` was removed                  | Configuration file | `offset: 0,`                           | [N/A]                                                                                                                         |
| `-o`/`--offset` was removed           | CLI arguments      | `-o 0`/`--offset 0`                    | [N/A]                                                                                                                         |
| `trackers` was removed                | Config file        | `trackers: ["oink", "tehconnection"],` | `torznab: ["http://localhost/prowlarr/1/api?apikey=APIKEY", "http://localhost/prowlarr/2/api?apikey=APIKEY"],`                | You'll have to use Torznab mode, see the README for instructions to find your torznab urls. You can also remove your `jackettApiKey` and `jackettServerUrl` config options.                  |
| `-t`/`--trackers` was removed         | CLI arguments      | `-t oink,tehconnection`                | `--torznab http://localhost/prowlarr/1/api?apikey=APIKEY http://localhost/prowlarr/2/api?apikey=APIKEY` (separated by spaces) | You'll have to use Torznab mode, see the README for instructions to find your torznab urls. You can also remove your `-k`/`--jackett-api-key` and `-u`/`--jackett-server-url` CLI arguments. |
| `searchAll`                           | Configuration file | `searchAll: true,`                     | `includeEpisodes: true, includeNonVideos: true,`                                                                              |
| `-a`/`--search-all`                   | CLI arguments      | `-a`                                   | `--include-non-videos --include-episodes`                                                                                     |

# New: support for periodic searches and RSS scans

-   Use the new `rssCadence`/`--rss-cadence` option to do periodic RSS scans
    -   enforced minimum of 10 minutes
    -   supports the [vercel/ms format](https://github.com/vercel/ms)
-   Use the new `searchCadence`/`--search-cadence` option to do periodic
    searches
    -   enforced minimum of 1 day
    -   supports the [vercel/ms format](https://github.com/vercel/ms)
