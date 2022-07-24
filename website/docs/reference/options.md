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
| [`torrentDir`](#torrentdir)                         | **Required** |
| [`outputDir`](#outputdir)                           | **Required** |
| [`includeEpisodes`](#includeepisodes)               |              |
| [`includeNonVideos`](#includenonvideos)             |              |
| [`fuzzySizeThreshold`](#fuzzysizethreshold)         |              |
| [`excludeOlder`](#excludeolder)                     |              |
| [`excludeRecentSearch`](#excluderecentsearch)       |              |
| [`action`](#action)                                 |              |
| [`rtorrentRpcUrl`](#rtorrentrpcurl)                 |              |
| [`qbittorrentUrl`](#qbittorrenturl)                 |              |
| [`notificationWebhookUrl`](#notificationwebhookurl) |              |

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

### `torznab`\*

| Config file name | CLI short form | CLI Long form         | Format     | Default           |
| ---------------- | -------------- | --------------------- | ---------- | ----------------- |
| `torznab`        | `-T <urls...>` | `--torznab <urls...>` | `string[]` | `[]` (empty list) |

List of Torznab URLs. You can use Jackett, Prowlarr, or indexer built-in Torznab
implementations.

:::caution

```
http://localhost:9117/p/a/t/h?query=string
└────────host───────┘└─path─┘└───query───┘
```

The **path** of each URL should end in `/api`.

:::

#### Finding your Torznab URLs

For [Prowlarr](https://github.com/Prowlarr/Prowlarr), click **(i)** and copy the
**Torznab Url**, then append `?apikey=YOUR_PROWLARR_API_KEY`.

For [Jackett](https://github.com/Jackett/Jackett), click **Copy RSS feed**.

:::note

This works because in Torznab, "RSS feeds" are just a search for the first page
of unfiltered (no search query) results from the indexer.

:::

#### `torznab` Examples (CLI)

```shell
cross-seed search --torznab https://localhost/prowlarr/1/api?apikey=12345
cross-seed search -T http://prowlarr:9696/1/api?apikey=12345 http://prowlarr:9696/2/api?apikey=12345
cross-seed search -T http://jackett:9117/api/v2.0/indexers/oink/results/torznab/api?apikey=12345
```

#### `torznab` Examples (Config file)

```js
torznab: ["https://localhost/prowlarr/1/api?apikey=12345"],

torznab: [
	"http://prowlarr:9696/1/api?apikey=12345",
    "http://prowlarr:9696/2/api?apikey=12345"
],

torznab: ["http://jackett:9117/api/v2.0/indexers/oink/results/torznab/api?apikey=12345"],
```

### `torrentDir`\*

| Config file name | CLI short form | CLI long form         | Format   | Default |
| ---------------- | -------------- | --------------------- | -------- | ------- |
| `torrentDir`     | `-i <dir>`     | `--torrent-dir <dir>` | `string` |         |

Point this at a directory containing torrent files. If you don't know where your
torrent client stores its files, the table below might help.

:::caution Docker users

Leave the `torrentDir` as `/torrents` and use Docker to map your directory to
`/torrents`.

:::

| Client           | Linux                                                      | Windows                                                   | Mac                                                   |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| **rTorrent**     | your session directory as configured in .rtorrent.rc       | your session directory as configured in .rtorrent.rc      | your session directory as configured in .rtorrent.rc  |
| **Deluge**       | `/home/<username>/.config/deluge/state`                    | Unknown (please submit a [PR][pr]!)                       | Unknown (please submit a [PR][pr]!)                   |
| **Transmission** | `/home/<username>/.config/transmission/torrents`           | Unknown (please submit a [PR][pr]!)                       | Unknown (please submit a [PR][pr]!)                   |
| **qBittorrent**  | `/home/<username>/.local/share/data/qBittorrent/BT_backup` | `C:\Users\<username>\AppData\Local\qBittorrent\BT_backup` | `~/Library/Application Support/qBittorrent/BT_backup` |

#### `torrentDir` Examples (CLI)

```shell
cross-seed search --torrent-dir ~/.config/deluge/state
cross-seed search -i ~/.config/transmission/torrents
```

#### `torrentDir` Examples (Config file)

```js
torrentDir: "/home/<username>/.config/deluge/state",

torrentDir: "/torrents",
```

### `outputDir`\*

| Config file name | CLI short form | CLI long form        | Format   | Default |
| ---------------- | -------------- | -------------------- | -------- | ------- |
| `outputDir`      | `-o <dir>`     | `--output-dir <dir>` | `string` |         |

`cross-seed` will store the torrent files it finds in this directory. If you use
[Injection](../tutorials/injection) with **rTorrent**, you'll need to make sure
rTorrent has access to this path also.

:::caution Docker users

Leave the `outputDir` as `/output` and use Docker to map your directory to
`/output`.

:::

#### `outputDir` Examples (CLI)

```shell
cross-seed search -o .
cross-seed search --output-dir /tmp/output
```

#### `outputDir` Examples (Config file)

```js
outputDir: "/output",

outputDir: "/tmp/output",

outputDir: ".",
```

### `includeEpisodes`

| Config file name  | CLI short form | CLI long form        | Format    | Default |
| ----------------- | -------------- | -------------------- | --------- | ------- |
| `includeEpisodes` | `-e`           | `--include-episodes` | `boolean` | `false` |

Set this to `true` to include single episode torrents in the search (which are
ignored by default).

#### `includeEpisodes` Examples (CLI)

```shell
cross-seed search -e # will include episodes
cross-seed search --include-episodes # will include episodes
cross-seed search --no-include-episodes # will not include episodes
cross-seed search # will not include episodes
```

#### `includeEpisodes` Examples (Config file)

```js
includeEpisodes: true,

includeEpisodes: false,
```

### `includeNonVideos`

| Config file name   | CLI short form | CLI long form          | Format    | Default |
| ------------------ | -------------- | ---------------------- | --------- | ------- |
| `includeNonVideos` |                | `--include-non-videos` | `boolean` | `false` |

Set this to `true` to include torrents which contain non-video files (`.mp4`,
`.avi`, `.mkv`) in the search (which are ignored by default).

#### `includeNonVideos` Examples (CLI)

```shell
cross-seed search --include-non-videos # will include non-videos
cross-seed search --no-include-non-videos # will not include non-videos
cross-seed search # will not include non-videos
```

#### `includeNonVideos` Examples (Config file)

```js
includeNonVideos: true,

includeNonVideos: false,
```

### `fuzzySizeThreshold` (experimental)

| Config file name     | CLI short form | CLI long form                    | Format                         | Default |
| -------------------- | -------------- | -------------------------------- | ------------------------------ | ------- |
| `fuzzySizeThreshold` |                | `--fuzzy-size-threshold <value>` | `number` (decimal from 0 to 1) | `0.02`  |

Increase this number to reject fewer torrents based on size. There is no
guarantee that it will increase your match rate.

https://github.com/mmgoodnow/cross-seed/blob/port-docs-from-wiki/src/decide.ts#L70-L87

:::caution

This option has very limited utility and under normal operation, does not need
to be modified.

:::

#### `fuzzySizeThreshold` Examples (CLI)

```shell
cross-seed search -d 10
cross-seed search --fuzzy-size-threshold 3
cross-seed daemon -d 5
```

#### `fuzzySizeThreshold` Examples (Config file)

```js
fuzzySizeThreshold: 20,
```

### `excludeOlder`

| Config file name | CLI short form | CLI long form             | Format                           | Default |
| ---------------- | -------------- | ------------------------- | -------------------------------- | ------- |
| `excludeOlder`   | `-x <value>`   | `--exclude-older <value>` | `string` in the [ms][ms] format) |         |

When running a search of your `torrentDir`, exclude torrents first searched more
than this long ago. This option is only relevant in `search` mode or in `daemon`
mode with [`searchCadence`](#searchcadence) turned on.

:::note

`excludeOlder` will never exclude torrents that are completely new.

:::

#### `excludeOlder` Examples (CLI)

```shell
cross-seed search -x 10h # only search for torrents whose first search was less than 10 hours ago or never
cross-seed search --exclude-older "3 days" # only search for torrents whose first search was less than 3 days ago or never
cross-seed search -x 0s # only search for each torrent once ever
```

#### `excludeOlder` Examples (Config file)

```js
excludeOlder: "10 hours",

excludeOlder: "3days",

excludeOlder: "0s",
```

### `excludeRecentSearch`

| Config file name      | CLI short form | CLI long form                     | Format                           | Default |
| --------------------- | -------------- | --------------------------------- | -------------------------------- | ------- |
| `excludeRecentSearch` | `-r <value>`   | `--exclude-recent-search <value>` | `string` in the [ms][ms] format) |         |

When running a search of your `torrentDir`, exclude torrents which have been
searched more recently than this long ago. This option is only relevant in
`search` mode or in `daemon` mode with [`searchCadence`](#searchcadence) turned
on.

#### `excludeRecentSearch` Examples (CLI)

```shell
cross-seed search -r 1day # only search for torrents that haven't been searched in the past day
cross-seed search --exclude-recent-search "2 weeks" # only search for torrents that haven't been searched in the past 2 weeks
```

#### `excludeRecentSearch` Examples (Config file)

```js
excludeRecentSearch: "1 day",

excludeRecentSearch: "2 weeks",
```

### `action`

| Config file name | CLI short form     | CLI long form            | Format          | Default |
| ---------------- | ------------------ | ------------------------ | --------------- | ------- |
| `action`         | `-A <save/inject>` | `--action <save/inject>` | `save`/`inject` | `save`  |

`cross-seed` can either save the found cross-seeds, or inject them into your
client. If you use `inject`, you will need to set up your client. Read more in
the [Injection tutorial](../tutorials/injection).

#### `action` Examples (CLI)

```shell
cross-seed search -A inject
cross-seed search --action save
```

#### `action` Examples (Config file)

```js
action: "save",

action: "inject",
```

### `rtorrentRpcUrl`

| Config file name | CLI short form | CLI long form              | Format | Default |
| ---------------- | -------------- | -------------------------- | ------ | ------- |
| `rtorrentRpcUrl` |                | `--rtorrent-rpc-url <url>` | URL    |         |

The url of your **rTorrent** XMLRPC interface. Only relevant with
[Injection](../tutorials/injection). Often ends in `/RPC2`.

If you use **Sonarr** or **Radarr**, cross-seed is configured the same way.
**ruTorrent** installations come with this endpoint configured but naked
**rTorrent** does not provide this wrapper. If you don't use **ruTorrent**,
you'll have to
[set up the endpoint yourself](https://github.com/linuxserver/docker-rutorrent/issues/122#issuecomment-769009432)
with a webserver.

If you use HTTP Digest Auth on this endpoint (recommended), then you can provide
credentials in the following format:
`http://username:password@localhost/rutorrent/RPC2`

#### `rtorrentRpcUrl` Examples (CLI)

```shell
cross-seed search --rtorrent-rpc-url http://rutorrent/rutorrent/RPC2
cross-seed search --rtorrent-rpc-url http://user:pass@localhost:8080/RPC2
```

#### `rtorrentRpcUrl` Examples (Config file)

```js
rtorrentRpcUrl: "http://rutorrent/rutorrent/RPC2",

rtorrentRpcUrl: "http://user:pass@localhost:8080/RPC2",
```

### `qbittorrentUrl`

| Config file name | CLI short form | CLI long form             | Format | Default |
| ---------------- | -------------- | ------------------------- | ------ | ------- |
| `qbittorrentUrl` |                | `--qbittorrent-url <url>` | URL    |         |

The url of your **qBittorrent** Web UI. Only relevant with
[Injection](../tutorials/injection).

**qBittorrent** doesn't use HTTP Basic/Digest Auth, but you can provide your
**qBittorrent** credentials at the beginning of the URL like so:
`http://username:password@localhost:8080/qbittorrent`

#### `qbittorrentUrl` Examples (CLI)

```shell
cross-seed search --qbittorrent-url http://qbittorrent:8080/qbittorrent
cross-seed search --qbittorrent-url http://user:pass@localhost:8080
```

#### `qbittorrentUrl` Examples (Config file)

```js
qbittorrentUrl: "http://qbittorrent:8080/qbittorrent",

qbittorrentUrl: "http://user:pass@localhost:8080",
```

### `notificationWebhookUrl`

| Config file name         | CLI short form | CLI long form                      | Format | Default |
| ------------------------ | -------------- | ---------------------------------- | ------ | ------- |
| `notificationWebhookUrl` |                | `--notification-webhook-url <url>` | URL    |         |

`cross-seed` will send a POST request to this URL with the following payload:

```http
POST notificationWebhookUrl
Content-Type: application/json

{
  "title": "string",
  "body": "string",
  "extra": {
    "event": "RESULTS",
    "name": "string",
    "infoHashes": "string[]",
    "trackers": "string[]",
    "source": "reverselookup | search",
    "result": "SAVED | INJECTED | FAILURE"
  }
}
```

Currently, cross-seed only sends the "RESULTS" event. In the future it may send
more. This payload supports both
[**apprise**](https://github.com/caronc/apprise-api) and
[**Notifiarr**](https://github.com/Notifiarr/Notifiarr).

#### `notificationWebhookUrl` Examples (CLI)

```shell
cross-seed daemon --notification-webhook-url http://apprise:8000/notify
```

#### `notificationWebhookUrl` Examples (Config file)

```js
notificationWebhookUrl: "http://apprise:8000/notify",
```

### `port`

| Config file name | CLI short form | CLI long form   | Format   | Default |
| ---------------- | -------------- | --------------- | -------- | ------- |
| `port`           | `-p <port>`    | `--port <port>` | `number` | `2468`  |

In [Daemon Mode](../basics/daemon.md), cross-seed runs a webserver listening for
a few types of HTTP requests. You can use this option to change the port it
listens on.

#### `port` Examples (CLI)

```shell
cross-seed daemon --port 3000
cross-seed daemon -p 3000
```

#### `port` Examples (Config file)

```js
port: 3000,
```

### `rssCadence`

| Config file name | CLI short form | CLI long form             | Format                          | Default |
| ---------------- | -------------- | ------------------------- | ------------------------------- | ------- |
| `rssCadence`     |                | `--rss-cadence <cadence>` | `string` in the [ms][ms] format |         |

In [Daemon Mode](../basics/daemon.md), with this option enabled, `cross-seed`
will run periodic RSS searches on your configured indexers to check if any new
uploads match torrents you already own. Setting this option to `null`, or not
specifying it at all, will disable the feature.

:::note

There is a minimum cadence of `10 minutes`. I recommend keeping it at a
relatively low number (10-30 mins) because if an indexer has a high frequency of
new uploads, keeping the number low will make sure `cross-seed` gets a chance to
see each new upload.

:::

#### `rssCadence` Examples (CLI)

```shell
cross-seed daemon --rss-cadence 10min
```

#### `rssCadence` Examples (Config file)

```js
rssCadence: null, // disable the RSS feature

rssCadence: "10 minutes",

rssCadence: "20min",
```

### `searchCadence`

| Config file name | CLI short form | CLI long form                | Format                          | Default |
| ---------------- | -------------- | ---------------------------- | ------------------------------- | ------- |
| `searchCadence`  |                | `--search-cadence <cadence>` | `string` in the [ms][ms] format |         |

In [Daemon Mode](../basics/daemon.md), with this option enabled, `cross-seed`
will run periodic searches of your torrents (respecting your `includeEpisodes`,
`includeNonVideos`, `excludeOlder`, and `excludeRecentSearch` settings).

:::tip

If you have RSS and on-finished-download searches set up, you can run these
**very infrequently** - on the order of dozens of weeks. There is a minimum of
**1 day**.

:::

#### `rssCadence` Examples (CLI)

```shell
cross-seed daemon --search-cadence "2 weeks"
cross-seed daemon --search-cadence "2w"

```

#### `rssCadence` Examples (Config file)

```js
searchCadence: null, // disable the periodic search feature

searchCadence: "2w",

searchCadence: "4 weeks",
```

[pr]:
	https://github.com/mmgoodnow/cross-seed/tree/master/website/docs/basics/options.md
[ms]: https://github.com/vercel/ms#examples
