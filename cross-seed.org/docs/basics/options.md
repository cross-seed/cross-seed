---
id: options
title: Options
sidebar_position: 3
---

`cross-seed` has several program options, which can either be specified on the
command line or in a configuration file. The priority is shown below.

```
CLI > Config File > Fallback
```

If you specify an option both on the command line and in the config file, the
command line value will override the config file's value.

:::danger

DO NOT remove options from the config file, this will cause errors.

:::

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

For instructions on creating and editing the config file, use the
[getting started guide](./getting-started.mdx#2-create-a-config-file). DO NOT
remove options from the config file, this will cause errors.

:::tip

[**What should I do after updating my config?**](./faq-troubleshooting.md#what-should-i-do-after-updating-my-config)

:::

## All options

### `delay`\*

| Config File Name | CLI Short Form | CLI Long Form     | Format             | Config Default | Fallback |
| ---------------- | -------------- | ----------------- | ------------------ | -------------- | -------- |
| `delay`          | `-d <value>`   | `--delay <value>` | `number` (seconds) | `30`           | `30`     |

When running a search with `cross-seed search` or using `searchCadence` in
daemon mode, the `delay` option lets you set how long you want `cross-seed` to
sleep in between searching for each torrent.

If you set it higher, it will smooth out the load on your indexer, however
setting this lower will result in `cross-seed` running faster.

:::warning DISCLAIMER

You need to read your tracker's rules and be aware of their limits.

**You and you alone are responsible for following your tracker's rules.**

:::

#### `delay` Examples (CLI)

```shell
cross-seed search -d 60
cross-seed search --delay 30
```

#### `delay` Examples (Config file)

```js
delay: 30,
```

### `torznab`\*

| Config File Name | CLI Short Form | CLI Long Form         | Format     | Config Default | Fallback |
| ---------------- | -------------- | --------------------- | ---------- | -------------- | -------- |
| `torznab`        | `-T <urls...>` | `--torznab <urls...>` | `string[]` | `[]`           | `[]`     |

List of Torznab URLs. You can use Jackett, Prowlarr, or indexer built-in Torznab
implementations.

This entry **MUST** be wrapped in []'s and strings inside wrapped with quotes
and separated by commas.

:::caution

```
http://localhost:9117/p/a/t/h?query=string
└────────host───────┘└─path─┘└───query───┘
```

The **path** of each URL should end in `/api`.

:::

#### Finding your Torznab URLs

For [Prowlarr](https://github.com/Prowlarr/Prowlarr) and
[Jackett](https://github.com/Jackett/Jackett) you can simply copy the **RSS
URL** from the WebUI.

For Prowlarr, the URL should include the indexer ID before `/api`, for example
`http://prowlarr:9696/1/api?apikey=12345`. The base Prowlarr API URL
`http://prowlarr:9696/api?apikey=12345` is not a Torznab endpoint and will
usually cause invalid XML or JSON parsing errors.

:::note

This works because in Torznab, "RSS feeds" are just a search for the first page
of unfiltered (no search query) results from the indexer.

:::

[See correct and wrong Torznab URL examples.](./common-setup-failures.md#torznab-and-prowlarr-urls)

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
    "http://prowlarr:9696/2/api?apikey=12345",
],

torznab: ["http://jackett:9117/api/v2.0/indexers/oink/results/torznab/api?apikey=12345"],
```

### `sonarr`

| Config File Name | CLI Short Form | CLI Long Form       | Format     | Config Default | Fallback |
| ---------------- | -------------- | ------------------- | ---------- | -------------- | -------- |
| `sonarr`         |                | `--sonarr <url(s)>` | `string[]` | `[]`           | `[]`     |

:::info NOTICE

Read about the functionality in the
[v6 Migration Guide](../v6-migration.md#searching-by-media-ids)

:::

The URL to your [Sonarr](https://sonarr.tv) instance with your `?apikey=`
parameter appended to the end.

#### Finding your Sonarr URL

For [Sonarr](https://sonarr.tv) you can simply append `?apikey=` to the end of
your WebUI base URL with your API key after the `=`.

#### `sonarr` Examples (CLI)

```shell
cross-seed search --sonarr https://localhost/?apikey=12345
cross-seed search --sonarr https://localhost/?apikey=12345 https://localhost4k/?apikey=12345
```

#### `sonarr` Examples (Config file)

```js
sonarr: ["https://sonarr/?apikey=12345"],

sonarr: ["http://sonarr:8989/?apikey=12345","http://sonarr4k:8990/?apikey=12345"],
```

:::warning NOTICE

If you are using a secure connection (HTTPS) to Sonarr and you are using a
certificate signed by a custom authority, make sure that the environment
variable
[`NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)
is set and contains the path to a file containing the root certificate of the
custom authority.

:::

### `radarr`

| Config File Name | CLI Short Form | CLI Long Form       | Format     | Config Default | Fallback |
| ---------------- | -------------- | ------------------- | ---------- | -------------- | -------- |
| `radarr`         |                | `--radarr <url(s)>` | `string[]` | `[]`           | `[]`     |

:::warning NOTICE

Read about the functionality in the
[v6 Migration Guide](../v6-migration.md#searching-by-media-ids)

:::

The URL to your [Radarr](https://radarr.video) instance with your `?apikey=`
parameter appended to the end.

#### Finding your Radarr URL

For [Radarr](https://radarr.video) you can simply append `?apikey=` to the end
of your WebUI base URL with your API key after the `=`.

#### `radarr` Examples (CLI)

```shell
cross-seed search --radarr https://localhost/?apikey=12345
cross-seed search --radarr https://localhost/?apikey=12345 https://localhost4k/?apikey=12345
```

#### `radarr` Examples (Config file)

```js
radarr: ["https://radarr/?apikey=12345"],

radarr: ["http://radarr:7878/?apikey=12345","https://radarr4k:7879/?apikey=12345"],
```

:::warning NOTICE

If you are using a secure connection (HTTPS) to Radarr and you are using a
certificate signed by a custom authority, make sure that the environment
variable
[`NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)
is set and contains the path to a file containing the root certificate of the
custom authority.

:::

### `useClientTorrents`

| Config File Name    | CLI Short Form | CLI Long Form           | Format    | Config Default | Fallback |
| ------------------- | -------------- | ----------------------- | --------- | -------------- | -------- |
| `useClientTorrents` | N/A            | `--use-client-torrents` | `boolean` | `true`         | `false`  |

:::warning

Deluge with Docker can have a desyncing issue with the WebUI daemon after
prolonged uptime with useClientTorrents, if you notice strange behavior you may
need to use [`torrentDir`](#torrentdir) instead.

:::

Query the torrent client APIs to find matches against its contents. This is a
replacement for torrentDir and is generally recommended. This method supports
qBittorrent's `SQLite` mode and all forms of content
layouts/renames/modifications to the torrent in client.

#### `useClientTorrents` Examples (CLI)

```shell
cross-seed search --use-client-torrents
cross-seed search --no-use-client-torrents
```

#### `useClientTorrents` Examples (Config file)

```js
useClientTorrents: true,
```

### `torrentDir`

| Config File Name | CLI Short Form | CLI Long Form         | Format   | Config Default | Fallback |
| ---------------- | -------------- | --------------------- | -------- | -------------- | -------- |
| `torrentDir`     | `-i <dir>`     | `--torrent-dir <dir>` | `string` | `null`         | `null`   |

:::danger qBittorrent

You **MUST** use [`useClientTorrents`](#useclienttorrents) instead if any apply:

- You are using `SQLite` in `Preferences -> Advanced`
- You have renamed torrents or its files in client
- You have torrents added _WITHOUT_ `Content Layout` set to `Original`

:::

Point this at a directory containing torrent files, **or if you're using a
torrent client integration and injection** - your torrent client's `.torrent`
file store/cache.

:::caution What directory is supported

More details on why using paths other than the .torrent store from the client's
config/appdata directory (ex: 'state' or 'BT_backup') is not supported and
discouraged
[can be found here.](./faq-troubleshooting.md#what-is-could-not-ensure-all-torrents-from-the-torrent-client-are-in-torrentdir)

:::

If you don't know where your torrent client stores its files, **please use the
table below to find the client's store of .torrent files**. This folder can then
either be mounted as something like `/torrents` (with read only (`:ro`)
permissions) as a "shorthanded" path if you're using Docker or used outright as
your `torrentDir`.

:::tip Data-Only Searching

If you wish to search only your data, we previously recommended pointing this to
an empty directory. You can now set this to `null` if you wish to search only
your `dataDirs`.

:::

| Client           | Linux                                                      | Windows                                                   | Mac                                                   |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| **rTorrent**     | your session directory as configured in .rtorrent.rc       | your session directory as configured in .rtorrent.rc      | your session directory as configured in .rtorrent.rc  |
| **Deluge**       | `/home/<username>/.config/deluge/state`                    | %APPDATA%\deluge\state                                    | current version of Deluge not officially supported    |
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

torrentDir: "C:\\torrents",
```

:::info WINDOWS USERS

[**It is necessary to insert double-slashes for your paths, back-slashes are "escape characters" and "\\\\" equates to "\\".**](./faq-troubleshooting.md#windows-paths)

:::

### `outputDir`

| Config File Name | CLI Short Form | CLI Long Form        | Format   | Config Default | Fallback |
| ---------------- | -------------- | -------------------- | -------- | -------------- | -------- |
| `outputDir`      | `-s <dir>`     | `--output-dir <dir>` | `string` | `null`         | `null`   |

::::tip

Keep this set to `outputDir: null` for the best experience with `cross-seed`.
This will map outputDir into your `cross-seed`
[config directory](./faq-troubleshooting.md#what-is-configdb-torrent_cache-and-cross-seeds-in-the-config-directory).

:::danger

**DO NOT USE THIS DIRECTORY AS A WATCH FOLDER FOR YOUR TORRENT CLIENT!**

:::

::::

With [`action: "inject"`](#action), `cross-seed` will use this directory to
retry injections only, it will be empty nearly all the time. With
[`action: "save"`](#action), `cross-seed` will store the .torrent files it finds
in this directory. Only change this from `null` if you are using
`action: "save"` and the path would be more convenient.

#### `outputDir` Examples (CLI)

```shell
cross-seed search
cross-seed search --output-dir /path/to/folder
```

#### `outputDir` Examples (Config file)

```js
outputDir: null,

outputDir: "/path/to/folder",
```

:::info WINDOWS USERS

[**It is necessary to insert double-slashes for your paths, back-slashes are "escape characters" and "\\\\" equates to "\\".**](./faq-troubleshooting.md#windows-paths)

:::

### `dataDirs`

| Config File Name | CLI Short Form          | CLI Long Form           | Format      | Config Default | Fallback |
| ---------------- | ----------------------- | ----------------------- | ----------- | -------------- | -------- |
| `dataDirs`       | `--data-dirs <dirs...>` | `--data-dirs <dirs...>` | `string(s)` | `[]`           | `[]`     |

:::tip

[**Usages and Configuration**](../tutorials/data-based-matching.md)

:::

`cross-seed` will search the paths provided (separated by spaces). If you use
[Injection](../tutorials/injection) `cross-seed` will use the specified linkType
to create a link to the original file in the linkDirs.

:::caution Docker

You will need to mount the volume for `cross-seed` to have access to the data
and linkDirs.

:::

#### `dataDirs` Examples (CLI)

```shell
cross-seed search --data-dirs /data/usenet/movies
```

#### `dataDirs` Examples (Config file)

```js
dataDirs: ["/data/usenet/movies"],

dataDirs: ["/data/usenet/movies", "/data/torrents/tv"],

dataDirs: ["C:\\My Data\\Downloads\\Movies"],
```

:::info WINDOWS USERS

[**It is necessary to insert double-slashes for your paths, back-slashes are "escape characters" and "\\\\" equates to "\\".**](./faq-troubleshooting.md#windows-paths)

:::

### `maxDataDepth`

| Config File Name | CLI Short Form | CLI Long Form              | Format   | Config Default | Fallback |
| ---------------- | -------------- | -------------------------- | -------- | -------------- | -------- |
| `maxDataDepth`   | N/A            | `--max-data-depth <value>` | `number` | `2`            | `2`      |

:::tip

[**What value should I set my `maxDataDepth` to?**](../tutorials/data-based-matching.md#setting-up-data-based-matching)

:::

Determines how deep into the specified [`dataDirs`](#datadirs) `cross-seed` will
go to generate searchees. Setting this to higher values will result in more
searchees and more API hits to your indexers.

#### `maxDataDepth` Examples (CLI)

```shell
cross-seed search --max-data-depth 2
```

#### `maxDataDepth` Examples (Config file)

```js
maxDataDepth: 2,
```

### `linkCategory`

| Config File Name | CLI Short Form | CLI Long Form                | Format   | Config Default    | Fallback          |
| ---------------- | -------------- | ---------------------------- | -------- | ----------------- | ----------------- |
| `linkCategory`   | N/A            | `--link-category <category>` | `string` | `cross-seed-link` | `cross-seed-link` |

`cross-seed` will use this category for all injected torrents when
[linking](../tutorials/linking.md) is enabled.

:::caution Docker

You will need to mount the volume for `cross-seed` to have access to the data
and linkDirs.

:::

#### `linkCategory` Examples (CLI)

```shell
cross-seed search --link-category category
```

#### `linkCategory` Examples (Config file)

```js
linkCategory: "Category1",
```

### `duplicateCategories`

| Config File Name      | CLI Short Form | CLI Long Form            | Format    | Config Default | Fallback |
| --------------------- | -------------- | ------------------------ | --------- | -------------- | -------- |
| `duplicateCategories` | N/A            | `--duplicate-categories` | `boolean` | `false`        | `false`  |

`cross-seed` will inject using the original category, appending '.cross-seed',
with the same save paths as your normal categories. For qBittorrent with linking
enabled, this will be applied as tag instead while keeping
[`linkCategory`](#linkcategory).

:::info

This will prevent an Arr from seeing duplicate torrents in Activity, and
attempting to import cross-seeds. You do not need to set this to `true` if you
are using linking.

Example: if you have a category called "Movies", this will automatically inject
cross-seeds to "Movies.cross-seed"

:::

#### `duplicateCategories` Examples (CLI)

```shell
cross-seed search --duplicate-categories
```

#### `duplicateCategories` Examples (Config file)

```js
duplicateCategories: true,

duplicateCategories: false,
```

### `linkDirs`

| Config File Name | CLI Short Form | CLI Long Form           | Format      | Config Default | Fallback |
| ---------------- | -------------- | ----------------------- | ----------- | -------------- | -------- |
| `linkDirs`       | N/A            | `--link-dirs <dirs...>` | `string(s)` | `[]`           | `[]`     |

:::tip

Ideally, you should only have a single linkDir and use drive pooling. Using
multiple linkDirs should be reserved for setups with cache/temp drives or where
drive pooling is impossible.

[**How to configure linking?**](../tutorials/linking.md)

:::

`cross-seed` will link (symlink/hardlink) in the path provided. If you use
[Injection](../tutorials/injection) `cross-seed` will use the specified linkType
to create a link to the original file in one of the `linkDirs` during searches
where the original data is accessible (both torrent and data-based matches). The
correct linkDir is chosen by matching the `stat.st_dev` for the source and link
paths. If no linkDir shares a `stat.st_dev` with the source, the injection will
fail for hardlinks and fallback to the first linkDir for symlinks.

:::caution Docker

You will need to mount the volume for `cross-seed` to have access to the dataDir
and linkDirs.

:::

#### `linkDirs` Examples (CLI)

```shell
cross-seed search --linkDirs /data/torrents/xseeds /data1/torrents/cross-seed-links
```

#### `linkDirs` Examples (Config file)

```js
linkDirs: ["/data/torrents/SomeLinkDirName"],

linkDirs: ["C:\\cross-seed-links", "D:\\xseeds"],
```

:::info WINDOWS USERS

[**It is necessary to insert double-slashes for your paths, back-slashes are "escape characters" and "\\\\" equates to "\\".**](./faq-troubleshooting.md#windows-paths)

:::

### `linkType`

| Config File Name | CLI Short Form       | CLI Long Form        | Format   | Config Default | Fallback  |
| ---------------- | -------------------- | -------------------- | -------- | -------------- | --------- |
| `linkType`       | `--link-type <type>` | `--link-type <type>` | `string` | `hardlink`     | `symlink` |

:::tip

[**What `linkType` should I use?**](../tutorials/linking.md)

:::

`cross-seed` will link (symlink/hardlink/reflink) in the method provided. If you
use [Injection](../tutorials/injection) `cross-seed` will use the specified
linkType to create a link to the original file in one of the linkDirs.

Valid methods for linkType are `symlink`, `hardlink`, and `reflink`.

:::tip

[**It's possible to use an alternative reflink method detailed here**](../tutorials/linking.md#reflink)

:::

#### `linkType` Examples (CLI)

```shell
cross-seed search --linkType hardlink
```

#### `linkType` Examples (Config file)

```js
linkType: "hardlink",

linkType: "symlink",
```

### `matchMode`

| Config File Name | CLI Short Form        | CLI Long Form         | Format                         | Config Default | Fallback |
| ---------------- | --------------------- | --------------------- | ------------------------------ | -------------- | -------- |
| `matchMode`      | `--match-mode <mode>` | `--match-mode <mode>` | `strict`/`flexible`/`partial*` | `flexible`     | `strict` |

`cross-seed` uses three types of matching algorithms `strict`, `flexible`, and
`partial`. All types are equally safe. `strict` is required if you cannot use
linking. Using `partial` will find all possible cross seeds of your data and
allows setting [`seasonFromEpisodes`](#seasonfromepisodes) to a value below 1.

:::note

These algorithms can only be ran if `cross-seed` has snatched the torrent files.
The vast majority of candidates get rejected before a snatch has happened by
parsing information from the title. Using `partial` minimizes the amount of
wasted snatches since it's the most complete.

:::

| option     | description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `strict`   | requires all file names to match exactly along with file sizes       |
| `flexible` | allows for file renames and slight inconsistencies                   |
| `partial`  | can be read about in detail [here](../tutorials/partial-matching.md) |

For media library searches `flexible` or `partial` is necessary due to the
renaming of files.

#### `matchMode` Examples (CLI)

```shell
cross-seed search --match-mode flexible
cross-seed search --match-mode strict
```

#### `matchMode` Examples (Config file)

```js
matchMode: "partial",

matchMode: "strict",
```

### `skipRecheck`

| Config File Name | CLI Short Form | CLI Long Form    | Format    | Config Default | Fallback |
| ---------------- | -------------- | ---------------- | --------- | -------------- | -------- |
| `skipRecheck`    | `N/A`          | `--skip-recheck` | `boolean` | `true`         | `true`   |

Set this to `false` to recheck all torrents upon injection. Set this to `true`
to only recheck necessary injections such those from [`partial`](#matchmode).

:::tip

Torrents will be resumed even with `skipRecheck: false`, if applicable.

:::

#### `skipRecheck` Examples (CLI)

```shell
cross-seed search # will skip rechecking
cross-seed search --no-skip-recheck # will not skip rechecking
```

#### `skipRecheck` Examples (Config file)

```js
skipRecheck: true,

skipRecheck: false,
```

### `includeSingleEpisodes`

| Config File Name        | CLI Short Form | CLI Long Form               | Format    | Config Default | Fallback |
| ----------------------- | -------------- | --------------------------- | --------- | -------------- | -------- |
| `includeSingleEpisodes` | `N/A`          | `--include-single-episodes` | `boolean` | `false`        | `false`  |

:::tip

It's recommended to use `includeSingleEpisodes: false` in your config and
override it for webhook commands triggered on
[`download completion`](../tutorials/triggering-searches.md#setting-up-your-torrent-client).
Combined with matching single episodes from announce, this should match all
episodes without the downside of searching for
[`trumped/dead torrents`](../v6-migration.md#updated-includesingleepisodes-behavior).

:::

Set this to `true` to include **ALL SINGLE** episodes when searching (which are
ignored by default).

:::info

This will **NOT** include episodes present inside season packs (data-based
searches).

Behavior of this option has changed in v6, please see the
[migration guide](../v6-migration.md#updated-includesingleepisodes-behavior) for
details on the implementation's changes'.

:::

#### `includeSingleEpisodes` Examples (CLI)

```shell
cross-seed search --include-single-episodes # will include single episodes not from season pack
cross-seed search # will not include episodes
```

#### `includeSingleEpisodes` Examples (Config file)

```js
includeSingleEpisodes: true,

includeSingleEpisodes: false,
```

### `seasonFromEpisodes`

| Config File Name     | CLI Short Form | CLI Long Form            | Format                         | Config Default | Fallback |
| -------------------- | -------------- | ------------------------ | ------------------------------ | -------------- | -------- |
| `seasonFromEpisodes` | `N/A`          | `--season-from-episodes` | `number` (decimal from 0 to 1) | `1`            | `null`   |

`cross-seed` will also aggregate individual episodes into season packs for
searching (when applicable) or to match with season packs from rss/announce.
This will only match season packs where you have at least the specified ratio of
episodes. `null` disables this feature. If enabled, values below 1 requires
matchMode [partial](#matchmode).

:::tip

This feature works best with matchMode [partial](#matchmode) and
[Sonarr](#sonarr). You can avoid downloading the same missing episodes on
multiple trackers by following
[these steps](./faq-troubleshooting.md#my-partial-matches-from-related-searches-are-missing-the-same-data-how-can-i-only-download-it-once).

:::

#### `seasonFromEpisodes` Examples (CLI)

```shell
cross-seed search --season-from-episodes 0.8 # will also combine episodes into season packs if you have at least 80%
cross-seed search --no-season-from-episodes # will not attempt to join episodes to season packs
```

#### `seasonFromEpisodes` Examples (Config file)

```js
seasonFromEpisodes: 0.8, // requires 80% of the episodes to cross-seed a season pack

seasonFromEpisodes: null, // will disable season pack from episodes
```

### `autoResumeMaxDownload`

| Config File Name        | CLI Short Form | CLI Long Form                | Format                   | Config Default | Fallback   |
| ----------------------- | -------------- | ---------------------------- | ------------------------ | -------------- | ---------- |
| `autoResumeMaxDownload` | `N/A`          | `--auto-resume-max-download` | `number` (0 to 52428800) | `52428800`     | `52428800` |

The amount remaining for an injected torrent in bytes for `cross-seed` to
resume. For torrents with a larger amount remaining, you will need to manually
resume as you can avoid downloading the same missing data on multiple trackers
by following
[these steps](./faq-troubleshooting.md#my-partial-matches-from-related-searches-are-missing-the-same-data-how-can-i-only-download-it-once).

#### `autoResumeMaxDownload` Examples (CLI)

```shell
cross-seed search --auto-resume-max-download 0 # only resume complete matches
```

#### `autoResumeMaxDownload` Examples (Config file)

```js
autoResumeMaxDownload: 52428800,

autoResumeMaxDownload: 0,
```

### `ignoreNonRelevantFilesToResume`

| Config File Name                 | CLI Short Form | CLI Long Form                           | Format    | Config Default | Fallback |
| -------------------------------- | -------------- | --------------------------------------- | --------- | -------------- | -------- |
| `ignoreNonRelevantFilesToResume` | `N/A`          | `--ignore-non-relevant-files-to-resume` | `boolean` | `false`        | `false`  |

If set to `true` and the amount remaining is above
[autoResumeMaxDownload](#autoresumemaxdownload), resume if accumulated size of
the missing files is less than the accumulated size of the known-irrelevant
files such as nfo, sample, txt, subs, proofs, and bonus/commentary files present
in the torrent.

:::note

The goal is to resume all torrents that meet this criteria. However, for safety,
a 200 MiB limit has been set on the remaining download size. We're open to
increasing this limit if needed.

:::

#### `ignoreNonRelevantFilesToResume` Examples (CLI)

```shell
cross-seed search --ignore-non-relevant-files-to-resume # will resume if the only files missing are known-irrelevant files
cross-seed search --no-ignore-non-relevant-files-to-resume # will not resume if the only files missing are known-irrelevant files
```

#### `ignoreNonRelevantFilesToResume` Examples (Config file)

```js
ignoreNonRelevantFilesToResume: true,
ignoreNonRelevantFilesToResume: false,
```

### `includeNonVideos`

| Config File Name   | CLI Short Form | CLI Long Form          | Format    | Config Default | Fallback |
| ------------------ | -------------- | ---------------------- | --------- | -------------- | -------- |
| `includeNonVideos` | N/A            | `--include-non-videos` | `boolean` | `false`        | `false`  |

:::warning NOTICE

Behavior of this option has changed in v6, please see the
[migration guide](../v6-migration.md#updated-includenonvideos-behavior) for
details on the implementation's changes.

:::

Set this to `true` to include torrents that contain a majority of files other
than video files (`.mp4`, `.avi`, `.mkv`) in the search.

For games and other non-video releases, set this to `true`. Expect lower match
quality than movies or TV because folder layouts, extras, patches, and release
names vary more across trackers.

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

### `fuzzySizeThreshold`

| Config File Name     | CLI Short Form | CLI Long Form                    | Format                           | Config Default | Fallback |
| -------------------- | -------------- | -------------------------------- | -------------------------------- | -------------- | -------- |
| `fuzzySizeThreshold` | N/A            | `--fuzzy-size-threshold <value>` | `number` (decimal from 0 to 0.1) | `0.02`         | `0.02`   |

Increase this number to reject fewer torrents based on size. There is no
guarantee that it will increase your match rate.

#### `fuzzySizeThreshold` Examples (CLI)

```shell
cross-seed search --fuzzy-size-threshold 0.02
cross-seed daemon --fuzzy-size-threshold 0.02
```

#### `fuzzySizeThreshold` Examples (Config file)

```js
fuzzySizeThreshold: 0.02,
```

### `excludeOlder`

| Config File Name | CLI Short Form | CLI Long Form             | Format                          | Config Default | Fallback    |
| ---------------- | -------------- | ------------------------- | ------------------------------- | -------------- | ----------- |
| `excludeOlder`   | `-x <value>`   | `--exclude-older <value>` | `string` in the [ms][ms] format | `2 weeks`      | `undefined` |

:::tip

[**How to ignore `excludeOlder` for a single search?**](./faq-troubleshooting.md#how-can-i-disable-the-time-based-exclude-options-in-a-cross-seed-search)

[**What's the best way to add new trackers?**](./faq-troubleshooting.md#whats-the-best-way-to-add-new-trackers)

If you prefer to spread out repeat searches for a longer safety net, use
`excludeRecentSearch: "90 days"` and `excludeOlder: "450 days"`.

:::

When running a search, this option excludes anything first searched more than
this long ago. This option is only relevant in `search` mode or in `daemon` mode
with [`searchCadence`](#searchcadence) turned on.

:::info Note

**Search history is stored on a per-indexer basis.**

Searches that failed on specific indexers (for example - due to timeout or
rate-limiting) will not be marked as having been searched, and thus will not be
excluded by this setting for those specific indexers on the next run.

:::

#### `excludeOlder` Examples (CLI)

```shell
cross-seed search -x 10h # only search for torrents whose first search was less than 10 hours ago or never
cross-seed search --exclude-older "3 days" # only search for torrents whose first search was less than 3 days ago or never
cross-seed search -x 0s # only search for each torrent once ever
cross-seed search --no-exclude-older # disables/overrides the excludeOlder value in config.js
```

#### `excludeOlder` Examples (Config file)

```js
excludeOlder: "10 hours",

excludeOlder: "3days",

excludeOlder: "0s",
```

### `excludeRecentSearch`

| Config File Name      | CLI Short Form | CLI Long Form                     | Format                          | Config Default | Fallback    |
| --------------------- | -------------- | --------------------------------- | ------------------------------- | -------------- | ----------- |
| `excludeRecentSearch` | `-r <value>`   | `--exclude-recent-search <value>` | `string` in the [ms][ms] format | `3 days`       | `undefined` |

:::tip

[**How to ignore `excludeRecentSearch` for a single search?**](./faq-troubleshooting.md#how-can-i-disable-the-time-based-exclude-options-in-a-cross-seed-search)

[**What's the best way to add new trackers?**](./faq-troubleshooting.md#whats-the-best-way-to-add-new-trackers)

If you prefer to spread out repeat searches for a longer safety net, use
`excludeRecentSearch: "90 days"` and `excludeOlder: "450 days"`.

:::

When running a search, this option excludes anything that has been searched more
recently than this long ago. This option is only relevant in `search` mode or in
`daemon` mode with [`searchCadence`](#searchcadence) turned on.

:::info Note

**Search history is stored on a per-indexer basis.**

Searches that failed on specific indexers (for example - due to timeout or
rate-limiting) will not be marked as having been searched, and thus will not be
excluded by this setting for those specific indexers on the next run.

:::

#### `excludeRecentSearch` Examples (CLI)

```shell
cross-seed search -r 1day # only search for torrents that haven't been searched in the past day
cross-seed search --exclude-recent-search "2 weeks" # only search for torrents that haven't been searched in the past 2 weeks
cross-seed search --no-exclude-recent-search # disables/overrides the excludeRecentSearch value in config.js
```

#### `excludeRecentSearch` Examples (Config file)

```js
excludeRecentSearch: "1 day",

excludeRecentSearch: "2 weeks",
```

### `action`\*

| Config File Name | CLI Short Form     | CLI Long Form            | Format          | Config Default | Fallback |
| ---------------- | ------------------ | ------------------------ | --------------- | -------------- | -------- |
| `action`         | `-A <save/inject>` | `--action <save/inject>` | `save`/`inject` | `inject`       | `save`   |

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

### `torrentClients`

| Config File Name | CLI Short Form | CLI Long Form                 | Format | Config Default | Fallback |
| ---------------- | -------------- | ----------------------------- | ------ | -------------- | -------- |
| `torrentClients` | N/A            | `--torrent-clients <urls...>` | URL(s) | `[]`           | `[]`     |

:::note Multiple Clients

`cross-seed` will never inject a torrent into a client if it exists in another.

If there similar torrents to source from in multiple clients, the order of the
clients defined will be used as the priority.

Injections from [`useClientTorrents`](#useclienttorrents) will be injected into
the client the match was sourced from or the first valid non-readonly client
with the first valid [`linkDir`](#linkdirs). Custom routing is not supported at
this time.

Injections from [`dataDirs`](#datadirs) will be injected into the first valid
client with the first valid [`linkDir`](#linkdirs). Custom routing is not
supported at this time.

:::

The URL(s) of your torrent client that `cross-seed` will source torrents from
prefixed by their client type. If desired, you can use `readonly:` after the
prefix to use a client to source cross seeds from but not inject into.

:::tip

[**You may need to urlencode your username and password if they contain special characters**](./faq-troubleshooting.md#can-i-use-special-characters-in-my-urls)

`cross-seed` must share the same
[user and group](./getting-started.mdx#docker-installation) permissions as the
torrent clients to prevent errors.

**You may need to use
[`cross-seed clear-client-cache`](../reference/utils.md#cross-seed-clear-client-cache)
if you change torrent clients or modify the torrents in client**

:::

#### `qbittorrent`

The url of your **qBittorrent** Web UI prefixed with `qbittorrent`:
`qbittorrent:http://user:pass@localhost:8080`

#### `deluge`

The url of your **Deluge** JSON-RPC Interface prefixed with `deluge`:
`deluge:http://:pass@localhost:8112/json`

#### `transmission`

The url of your **Transmission** RPC Interface prefixed with `transmission`:
`transmission:http://user:pass@localhost:9091/transmission/rpc`

#### `rtorrent`

The url of your **rTorrent** XMLRPC interface prefixed with `rtorrent`:
`rtorrent:http://user:pass@localhost:8080/RPC2` or
`rtorrent:http://user:pass@localhost:8080/rutorrent/plugins/httprpc/action.php`

`cross-seed` can also speak SCGI directly, which needs no webserver in front of
rTorrent:

- `rtorrent:scgi:///path/to/.rpc.socket` for a socket, set in `.rtorrent.rc` by
  `network.scgi.open_local` (older configs spell this `scgi_local`).
- `rtorrent:scgi://localhost:5000` for a port, set by `network.scgi.open_port`
  (older configs spell this `scgi_port`). IPv6 literals go in brackets, as in
  `rtorrent:scgi://[::1]:5000`.

Prefer the socket where you can, and only ever bind the port to localhost:
anyone who can reach either endpoint can run commands as the user rTorrent runs
as. SCGI has no authentication of its own, so any credentials in an `scgi://`
url are ignored — restrict the socket with filesystem permissions instead.

:::caution

`cross-seed` sends the whole `.torrent` in one XML-RPC call when it injects, so
a torrent with many files can exceed rTorrent's `network.xmlrpc.size_limit` and
fail to inject. Raise it in `.rtorrent.rc` if injections fail on large torrents:

```ini
network.xmlrpc.size_limit.set = 8M
```

:::

If `cross-seed` runs in a container, the socket has to be reachable inside it at
the same path and make sure the container user can write to it.

:::info

If you use **Sonarr** or **Radarr**, `cross-seed` is configured the same way.
**ruTorrent** installations come with this endpoint configured, but naked
**rTorrent** does not provide this wrapper. If you don't use **ruTorrent**,
connect over SCGI as shown above, or
[set up the endpoint yourself](https://github.com/linuxserver/docker-rutorrent/issues/122#issuecomment-769009432)
with a webserver.

:::

:::tip

If you use HTTP Digest Auth on this endpoint (recommended), then you can provide
credentials in the following format:
`http://username:password@localhost/rutorrent/RPC2`

:::

#### `torrentClients` Examples (CLI)

```shell
cross-seed search --torrent-clients rtorrent:http://rutorrent/rutorrent/RPC2
cross-seed search --torrent-clients rtorrent:http://user:pass@localhost:8080/RPC2 qbittorrent:http://user:pass@localhost:8080
cross-seed search --torrent-clients rtorrent:readonly:http://user:pass@localhost:8080/RPC2 qbittorrent:http://user:pass@localhost:8080
```

#### `torrentClients` Examples (Config file)

```js
torrentClients: ["deluge:http://:pass@localhost:8112/json"],

torrentClients: [
	"qbittorrent:http://user:pass@localhost:8080",
	"deluge:http://:pass@localhost:8112/json",
	"transmission:readonly:http://user:pass@localhost:9091/transmission/rpc",
	"rtorrent:http://user:pass@localhost:8080/RPC2",
],
```

### `notificationWebhookUrls`

| Config File Name          | CLI Short Form | CLI Long Form                           | Format | Config Default | Fallback |
| ------------------------- | -------------- | --------------------------------------- | ------ | -------------- | -------- |
| `notificationWebhookUrls` | N/A            | `--notification-webhook-urls <urls...>` | URL[]  | `[]`           | `[]`     |

`cross-seed` will send a POST request to these URLs with the following payload:

```json
POST notificationWebhookUrl
Content-Type: application/json

{
  "title": "string",
  "body": "string",
  "extra": {
    "event": "RESULTS | TEST",
    "name": "string",
    "infoHashes": ["string"],
    "trackers": ["string"],
    "source": "announce | inject | rss | search | webhook",
    "result": "SAVED | INJECTED | FAILURE",
    "paused": false,
    "decisions": ["string"],
    "searchee": {
      "category": "string",
      "tags": ["string"],
      "trackers": ["string"],
      "length": 123,
      "clientHost": "string",
      "infoHash": "string",
      "path": "string",
      "source": "torrentClient | torrentFile | dataDir | virtual"
    }
  }
}
```

Currently, `cross-seed` only sends the "RESULTS" and "TEST" events. In the
future it may send more. This payload supports both
[**apprise**](https://github.com/caronc/apprise-api) and
[**Notifiarr**](https://github.com/Notifiarr/Notifiarr).

#### `notificationWebhookUrls` Examples (CLI)

```shell
cross-seed daemon --notification-webhook-urls http://apprise:8000/notify http://apprise:8001/notify
```

#### `notificationWebhookUrls` Examples (Config file)

```js
notificationWebhookUrls: ["http://apprise:8000/notify", "http://apprise:8001/notify"],
```

### `host`

| Config File Name | CLI Short Form | CLI Long Form   | Format    | Config Default | Fallback  |
| ---------------- | -------------- | --------------- | --------- | -------------- | --------- |
| `host`           | N/A            | `--host <host>` | `host/ip` | `0.0.0.0`      | `0.0.0.0` |

In [Daemon Mode](./managing-the-daemon), `cross-seed` runs a webserver listening
for a few types of HTTP requests. You can use this option to change the host to
bind to and listen on.

Unless you have an address on your interface you wish **NOT** to listen on, or
have a special set of networking requirements, you likely **DO NOT** need to
change the host from `"0.0.0.0"`.

#### `host` Examples (CLI)

```shell
cross-seed daemon --host 192.168.1.100
```

#### `host` Examples (Config file)

```js
host: "1.3.3.7",
```

### `port`\*

| Config File Name | CLI Short Form | CLI Long Form   | Format   | Config Default | Fallback |
| ---------------- | -------------- | --------------- | -------- | -------------- | -------- |
| `port`           | `-p <port>`    | `--port <port>` | `number` | `2468`         | `2468`   |

In [Daemon Mode](./managing-the-daemon), `cross-seed` runs a webserver listening
for a few types of HTTP requests. You can use this option to change the port it
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

| Config File Name | CLI Short Form | CLI Long Form             | Format                          | Config Default | Fallback    |
| ---------------- | -------------- | ------------------------- | ------------------------------- | -------------- | ----------- |
| `rssCadence`     | N/A            | `--rss-cadence <cadence>` | `string` in the [ms][ms] format | `30 minutes`   | `undefined` |

:::tip

[**How to cross seed new releases as soon as they are uploaded?**](../tutorials/announce.md)

[**How to trigger ahead of schedule?**](./faq-troubleshooting.md#is-there-a-way-to-trigger-a-specific-cross-seed-job-ahead-of-schedule)

:::

In [Daemon Mode](./managing-the-daemon), with this option enabled, `cross-seed`
will run periodic RSS searches on your configured indexers to check if any new
uploads match torrents you already own. Setting this option to `null`, or not
specifying it at all, will disable the feature.

:::tip

There is a minimum cadence of `10 minutes`. We recommend keeping it at a
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

| Config File Name | CLI Short Form | CLI Long Form                | Format                          | Config Default | Fallback    |
| ---------------- | -------------- | ---------------------------- | ------------------------------- | -------------- | ----------- |
| `searchCadence`  |                | `--search-cadence <cadence>` | `string` in the [ms][ms] format | `1 day`        | `undefined` |

::::tip

[**How to trigger a search on download completion?**](../tutorials/triggering-searches.md)

[**How to trigger ahead of schedule?**](./faq-troubleshooting.md#is-there-a-way-to-trigger-a-specific-cross-seed-job-ahead-of-schedule)

:::warning

There is no reason to increase this value above the minimum of `1 day`. This
will negatively affect [`searchLimit`](#searchlimit), delay your searches, and
cause them to be bunched up rather than spread out. If you wish to control the
frequency in which torrents are searched, use the
[`excludeOlder`](#excludeolder) and
[`excludeRecentSearch`](#excluderecentsearch) options instead.

:::

::::

In [Daemon Mode](./managing-the-daemon), with this option enabled, `cross-seed`
will run periodic searches of your torrents (respecting your `includeEpisodes`,
`includeNonVideos`, `excludeOlder`, and `excludeRecentSearch` settings).

#### `searchCadence` Examples (CLI)

```shell
cross-seed daemon --search-cadence "2 weeks"
cross-seed daemon --search-cadence "2w"
```

#### `searchCadence` Examples (Config file)

```js
searchCadence: null, // disable the periodic search feature

searchCadence: "2w",

searchCadence: "4 weeks",
```

[pr]:
	https://github.com/cross-seed/cross-seed.org/tree/master/docs/basics/options.md
[ms]: https://github.com/vercel/ms#examples

### `apiKey`

| Config File Name | CLI Short Form | CLI Long Form     | Format   | Config Default | Fallback    |
| ---------------- | -------------- | ----------------- | -------- | -------------- | ----------- |
| `apiKey`         |                | `--api-key <key>` | `string` | `undefined`    | `undefined` |

:::info

`apiKey` is disabled in the config file by default, if you want to specify a key
set it to a valid key (24 character min).

:::

To find your generated API key, run the `cross-seed api-key` command. The API
key can be included with your requests in either of two ways:

If `apiKey` is unset in `config.js`, `cross-seed` uses its generated key. If you
set `apiKey` yourself, that configured value is the active key after restart.
When in doubt, run `cross-seed api-key` in the same environment where the daemon
runs, such as inside the Docker container.

```shell
# provide api key as a query param
curl -XPOST localhost:2468/api/webhook?apikey=YOUR_API_KEY --data-urlencode ...
# provide api key as an HTTP header
curl -XPOST localhost:2468/api/webhook -H "X-Api-Key: YOUR_API_KEY" --data-urlencode ...
```

#### `apiKey` Examples (CLI)

```shell
cross-seed daemon --api-key <key> # will require auth on requests
```

#### `apiKey` Examples (Config file)

```js
apiKey: undefined,
apiKey: "abcdefghijklmn0pqrstuvwxyz",
```

### `snatchTimeout`

| Config File Name | CLI Short Form | CLI Long Form                | Format                          | Config Default | Fallback     |
| ---------------- | -------------- | ---------------------------- | ------------------------------- | -------------- | ------------ |
| `snatchTimeout`  |                | `--snatch-timeout <timeout>` | `string` in the [ms][ms] format | `30 seconds`   | `30 seconds` |

:::warning

A single search (for which there could be thousands) could require multiple
snatches which happens sequentially. Similarly, a single rss event could have
thousands of candidates to parse through. Setting this value too high or to
`undefined` could indenfintely delay how quickly `cross-seed` can process
candidates for no real benefit.

:::

This option applies to any snatch (download) of a .torrent file via Torznab. If
a response is not given in the amount of time specified then it will consider
the snatch as failed.

#### `snatchTimeout` Examples (CLI)

```shell
cross-seed daemon --snatch-timeout "15s"
cross-seed search --snatch-timeout "30s"
```

#### `snatchTimeout` Examples (Config file)

```js
snatchTimeout: undefined, // disable the snatch timeout (http default)

snatchTimeout: "30s",

snatchTimeout: "15s",
```

[pr]:
	https://github.com/cross-seed/cross-seed.org/tree/master/docs/basics/options.md
[ms]: https://github.com/vercel/ms#examples

### `searchTimeout`

| Config File Name | CLI Short Form | CLI Long Form                | Format                          | Config Default | Fallback    |
| ---------------- | -------------- | ---------------------------- | ------------------------------- | -------------- | ----------- |
| `searchTimeout`  |                | `--search-timeout <timeout>` | `string` in the [ms][ms] format | `2 minutes`    | `2 minutes` |

:::warning

`cross-seed` may need to perform thousands of searches in a single run. Setting
this value too high or to `undefined` could indenfintely delay how quickly
`cross-seed` can process candidates for no real benefit.

:::

This option applies to any search via Torznab. If the search response is not
given in the amount of time specified then it will consider the search failed.

#### `searchTimeout` Examples (CLI)

```shell
cross-seed daemon --search-timeout "20s"
cross-seed search --search-timeout "45s"
```

#### `searchTimeout` Examples (Config file)

```js
searchTimeout: undefined, // disables searchTimeout (http default)

searchTimeout: "60s",

searchTimeout: "20s",
```

[pr]:
	https://github.com/cross-seed/cross-seed.org/tree/master/docs/basics/options.md
[ms]: https://github.com/vercel/ms#examples

### `searchLimit`

| Config File Name | CLI Short Form | CLI Long Form             | Format   | Config Default | Fallback    |
| ---------------- | -------------- | ------------------------- | -------- | -------------- | ----------- |
| `searchLimit`    |                | `--search-limit <number>` | `number` | `400`          | `undefined` |

Stop searching after the number of search queries meets the number specified.

[**Read more**](../reference/tracker-impact.md#limiting-search-volume)

#### `searchLimit` Examples (CLI)

```shell
cross-seed daemon --search-limit 50
cross-seed search --search-limit 150
```

#### `searchLimit` Examples (Config file)

```js
searchLimit: undefined, // disable search count limits

searchLimit: 150,
```

### `flatLinking`

| Config File Name | CLI Short Form | CLI Long Form    | Format    | Config Default | Fallback |
| ---------------- | -------------- | ---------------- | --------- | -------------- | -------- |
| `flatLinking`    | N/A            | `--flat-linking` | `boolean` | `false`        | `false`  |

:::caution Be Advised

qBittorrent users using an external program or script, such as qbit_manage, will
need extra considerations for `flatLinking: false`.

[**Read more about specific usage**](../v6-migration.md#new-folder-structure-for-links)

:::

With `false`, `cross-seed` will link any matches to a tracker-specific folder
inside of `linkDirs` (if set). This prevents cross seeds from conflicting with
each other. The tracker subfolder names will correspond to the ones set in
Prowlarr/Jackett and autobrr, ensure they match to prevent multiple folders for
a single tracker. Set this to `true` to use the flat-folder style linking
previously used in v5.

With `flatLinking: false` (default):

```
linkDir/
├─ TrackerA/
│  ├─ Movie.mkv
├─ TrackerB/
│  ├─ Movie.mkv
│  ├─ Show S01/
│  |  ├─ Show S01E01.mkv
```

With `flatLinking: true`:

```
linkDir/
├─ Movie.mkv   <--- Both TrackerA and TrackerB cross seeds share the same file
├─ Show S01/
│  ├─ Show S01E01.mkv
```

#### `flatLinking` Examples (CLI)

```shell
cross-seed search --flat-linking
```

#### `flatLinking` Examples (Config file)

```js
flatLinking: true,

flatLinking: false,
```

### `blockList`

| Config File Name | CLI Short Form | CLI Long Form            | Format      | Config Default | Fallback |
| ---------------- | -------------- | ------------------------ | ----------- | -------------- | -------- |
| `blockList`      | N/A            | `--block-list <strings>` | `string(s)` | `[]`           | `[]`     |

:::tip

Use the blocklist on categories, tags, or trackers on torrents you do not want
to cross seed from your torrent client.

:::

`cross-seed` will exclude any of the files/releases from cross-seeding during
the prefiltering done for each search/inject/rss/announce/webhook use. The full
list of supported prefixes are:

- `name:` A substring of the name inside the .torrent file or parsed name from
  path if data based.
- `nameRegex:` Similar to name but uses your own custom regex.
- `folder:` A substring of any parent folder in the path. Only applies to
  [`dataDirs`](#datadirs) searchees, not ones from your torrent client.
- `folderRegex:` Similar to folder but uses your own custom regex on the entire
  parent path.
- `category:` Deluge labels are considered categories. `"category:"` blocklists
  torrents without a category.
- `tag:` Transmission and rTorrent labels are considered tags. `"tag:"`
  blocklists torrents without a tag.
- `tracker:` If the announce url (from client/.torrent) is
  `https://user:pass@tracker.example.com:8080/announce/key` you must use host
  `tracker.example.com:8080`.
- `infoHash:` Blocklist the torrent that matches this infohash
  (case-insensitive).
- `sizeBelow:` Blocklist searchees with a size in bytes below this number.
- `sizeAbove:` Blocklist searchees with a size in bytes above this number.

`category:` matches the category or label reported by your torrent client.
`tag:` matches the tag or label reported by your torrent client. Blocklist rules
are evaluated when `cross-seed` builds the candidate set for search, webhook,
inject, RSS, and announce jobs. If another automation changes categories or tags
at nearly the same time, the result depends on what the client reports when
`cross-seed` reads that torrent.

:::danger

The regex (ECMAScript flavor) options are for advanced users only. Do not use
without rigorous testing as `cross-seed` is unable to perform any checks. Use at
your own risk.

:::

#### `blockList` Examples (Config file)

```js
blockList: [
    "name:Release.Name",
    "name:-excludedGroup",
    "name:x265",
    "nameRegex:[Rr]elease[.\s][Nn]ame",
    "folder:folderName",
    "folderRegex:folder\d+",
    "category:icycool",
    "category:",
    "tag:everybody",
    "tag:",
    "tracker:tracker.example.com:8080",
    "infoHash:3317e6485454354751555555366a8308c1e92093",
    "sizeBelow:12345",
    "sizeAbove:98765",
],
```
