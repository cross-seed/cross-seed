---
id: options
title: Options
---

`cross-seed` has several program options, which can either be specified on the
command line or in a configuration file. The priority is shown below.

```
CLI > config file > defaults
```

If you specify an option both on the command line and in the config file, the
command line value will override the config file value.

## Options on the command line

All options on the command line have a long form, which looks like
`--long-form-option <value>`. Some more common options have a single-letter
short form as well, which look like `-f <value>`.

Some options take multiple arguments, which are always separated by spaces:

```
--variadic-option arg1 arg2 arg3
```

:::tip

Any references to options you see in `camelCase` have their corresponding
long-form option name as the `kebab-cased` variant. For example, the
`excludeRecentSearch` option's long-form CLI option name is
`--exclude-recent-search`.

:::

## Options in the config file

`cross-seed` will look for a configuration file at

-   **Mac**/**Linux**/**Unix**: `~/.cross-seed/config.js`
-   **Windows**: `AppData\Local\cross-seed\config.js`

:::tip

If you would like to use a custom config directory, you can set the `CONFIG_DIR`
environment variable.

:::

To create an editable config file, run the following command:

```shell script
cross-seed gen-config
```

From there, you can open the config file in your favorite editor and set up your
configuration.

:::tip

The configuration file uses JavaScript syntax, which means:

-   Array/multi options must be enclosed in \[brackets\].
-   Strings must be enclosed in "quotation" marks.
-   Array elements and options must be separated by commas.

:::

## Options used in `cross-seed search`

| Option                                              | Required     |
| --------------------------------------------------- | ------------ |
| [`delay`](#delay)                                   |              |
| [`torznab`](#torznab)                               | **Required** |
| [`torrentDir`](#torrentDir)                         | **Required** |
| [`outputDir`](#outputDir)                           | **Required** |
| [`includeEpisodes`](#includeEpisodes)               |              |
| [`includeNonVideos`](#includeNonVideos)             |              |
| [`fuzzySizeThreshold`](#fuzzySizeThreshold)         |              |
| [`excludeOlder`](#excludeOlder)                     |              |
| [`excludeRecentSearch`](#excludeRecentSearch)       |              |
| [`action`](#action)                                 |              |
| [`rtorrentRpcUrl`](#rtorrentRpcUrl)                 |              |
| [`qbittorrentUrl`](#qbittorrentUrl)                 |              |
| [`notificationWebhookUrl`](#notificationWebhookUrl) |              |

## Options used in `cross-seed daemon`

| Option                                              | Required     |
| --------------------------------------------------- | ------------ |
| [`delay`](#delay)                                   |              |
| [`torznab`](#torznab)                               | **Required** |
| [`torrentDir`](#torrentDir)                         | **Required** |
| [`outputDir`](#outputDir)                           | **Required** |
| [`includeEpisodes`](#includeEpisodes)               |              |
| [`includeNonVideos`](#includeNonVideos)             |              |
| [`fuzzySizeThreshold`](#fuzzySizeThreshold)         |              |
| [`excludeOlder`](#excludeOlder)                     |              |
| [`excludeRecentSearch`](#excludeRecentSearch)       |              |
| [`action`](#action)                                 |              |
| [`rtorrentRpcUrl`](#rtorrentRpcUrl)                 |              |
| [`qbittorrentUrl`](#qbittorrentUrl)                 |              |
| [`notificationWebhookUrl`](#notificationWebhookUrl) |              |
| [`port`](#port)                                     |              |
| [`rssCadence`](#rssCadence)                         |              |
| [`searchCadence`](#searchCadence)                   |              |

## All options

### `delay`

| Config file name | CLI short form | CLI Long form     | Format             | Default |
| ---------------- | -------------- | ----------------- | ------------------ | ------- |
| `delay`          | `-d <value>`   | `--delay <value>` | `number` (seconds) | `10`    |

When running a search with `cross-seed search` or using `searchCadence` in
daemon mode, the `delay` option lets you set how long you want `cross-seed` to
sleep in between searching for each torrent. If you set it higher, it will
smooth out load on your indexers, but if you set it lower, `cross-seed` will run
faster. I don't recommend setting this lower than 2, as it could garner you
unwanted attention from tracker staff.

#### `delay` Examples (CLI)

```shell
cross-seed search -d 10
cross-seed search --delay 3
cross-seed daemon -d 5
```

#### `delay` Examples (Config file)

```js
delay: 20,
```

### `torznab`

| Config file name | CLI short form | CLI Long form       | Format             | Default |
| ---------------- | -------------- | ------------------- | ------------------ | ------- |
| `torznab`        | `-d <value>`   | `--torznab <value>` | `number` (seconds) | `10`    |

When running a search with `cross-seed search` or using `searchCadence` in
daemon mode, the `torznab` option lets you set how long you want `cross-seed` to
sleep in between searching for each torrent. If you set it higher, it will
smooth out load on your indexers, but if you set it lower, `cross-seed` will run
faster. I don't recommend setting this lower than 2, as it could garner you
unwanted attention from tracker staff.

#### `torznab` Examples (CLI)

```shell
cross-seed search -d 10
cross-seed search --torznab 3
cross-seed daemon -d 5
```

#### `torznab` Examples (Config file)

```js
torznab: 20,
```

### Table

| option                   | short form | type                                                               | default | description                                                                                                                                                                                               |
| ------------------------ | ---------- | ------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `torznab`                | `-T`       | `string[]`                                                         |         | List of Torznab urls. The **path** part should end in `/api`. For Jackett, click **Copy RSS feed**. For Prowlarr, click **(i)** and copy the **Torznab Url**, then append `?apikey=YOUR_PROWLARR_API_KEY` |
| `torrentDir`             | `-i`       | `string`                                                           |         | directory containing torrent files. For rtorrent, this is your session directory as configured in your .rtorrent.rc file. For deluge, this is ~/.config/deluge/state.                                     |
| `outputDir`              | `-o`       | `string`                                                           |         | directory to put the torrent files that cross-seed finds for you                                                                                                                                          |
| `includeEpisodes`        | `-e`       | `boolean`                                                          |         | Set this to `true` to include single episode torrents in the search (which are ignored by default)                                                                                                        |
| `includeNonVideos`       |            | `boolean`                                                          |         | Include torrents which contain non-video files                                                                                                                                                            |
| `fuzzySizeThreshold`     |            | `number` from 0 to 1                                               | `0.02`  | Increase this number to reject fewer torrents based on size.                                                                                                                                              |
| `excludeOlder`           | `-x`       | `string` in the [ms](https://github.com/vercel/ms#examples) format |         | Exclude torrents first searched more than this long ago.                                                                                                                                                  |
| `excludeRecentSearch`    | `-r`       | `string` in the [ms](https://github.com/vercel/ms#examples) format |         | Exclude torrents which have been searched more recently than this long ago.                                                                                                                               |
| `action`                 | `-A`       | `save` or `inject`                                                 | `save`  | `cross-seed` can either save the found cross-seeds, or inject them into your client. If you use `inject`, you need to set up one of the below clients.                                                    |
| `rtorrentRpcUrl`         |            | `string`                                                           |         | The url of your rtorrent XMLRPC interface. Only relevant with `action: "inject"`. Often ends in `/RPC2`. Credentials format: `http://username:password@localhost/rutorrent/RPC2`                          |
| `qbittorrentUrl`         |            | `string`                                                           |         | The url of your qBittorrent webui. Only relevant with `action: "inject"`. Credentials format: `http://username:password@localhost:8080`                                                                   |
| `notificationWebhookUrl` |            | `string`                                                           |         | `cross-seed` will send POST requests to this url with a JSON payload of `{ title, body }`. Conforms to the `caronc/apprise` REST API.                                                                     |
| `port`                   | `-p`       | `number`                                                           | `2468`  | Listen on a custom port.                                                                                                                                                                                  |
| `rssCadence`             |            | `string` in the [ms](https://github.com/vercel/ms#examples) format |         | Run rss scans on a schedule. Set to undefined or null to disable. Minimum of 10 minutes.                                                                                                                  |
| `searchCadence`          |            | `string` in the [ms](https://github.com/vercel/ms#examples) format |         | Run searches on a schedule. Set to undefined or null to disable. Minimum of 1 day. If you have RSS enabled, you won't need to run this often (2+ weeks recommended)                                       |
