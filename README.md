# cross-seed: Fully-automatic, no false positives

`cross-seed` is an app designed to help you download torrents that you can cross
seed based on your existing torrents. It is designed to match conservatively to
minimize manual intervention.

`cross-seed` can inject the torrents it finds directly into your torrent client.
Currently the supported clients are

-   rTorrent
-   qBittorrent

[Request your client here.](https://github.com/mmgoodnow/cross-seed/issues/new)

If your client isn't supported, `cross-seed` will download a bunch of torrent
files to a folder you specify. After that, I recommend using
[AutoTorrent](https://github.com/JohnDoee/autotorrent) to do the last-mile
delivery into your client.

## Requirements

-   [Node 14+](https://nodejs.org/en/download)
-   [Jackett](https://github.com/Jackett/Jackett)

It will work on Mac and on Linux; I haven't tested it on Windows but it should
work there too.

## Usage

Invoking `cross-seed` is _almost_ as simple as:

```shell script
npx cross-seed
```

Here's an example invocation:

```shell script
npx cross-seed search \
  --jackett-server-url http://localhost:9117/jackett \
  --jackett-api-key JACKETT_API_KEY \
  --torrent-dir /home/rtorrent/.session \
  --output-dir /tmp/torrents
```

You either need to give it a lot of command-line arguments or create a
[configuration file](https://github.com/mmgoodnow/cross-seed/wiki/Configuration-file).

```text
Usage: cross-seed search [options]

Search for cross-seeds


Options:
  -u, --jackett-server-url <url>        Your Jackett server url
  -k, --jackett-api-key <key>           Your Jackett API key
  -t, --trackers <tracker1>,<tracker2>  Comma-separated list of Jackett tracker ids to search (Tracker ids can be found in their Torznab feed paths)
  -i, --torrent-dir <dir>               Directory with torrent files
  -s, --output-dir <dir>                Directory to save results in
  -a, --search-all                      Search for all torrents regardless of their contents (default: false)
  --fuzzy-size-threshold <decimal>      The size difference allowed to be considered a match. (default: 0.02)
  -v, --verbose                         Log verbose output (default: false)
  -A, --action <action>                 If set to 'inject', cross-seed will attempt to add the found torrents to your torrent client. (choices: "save", "inject", default: "save")
  --rtorrent-rpc-url <url>              The url of your rtorrent XMLRPC interface. Requires '-A inject'. See the docs for more information.
  --qbittorrent-url <url>               The url of your qBittorrent webui. Requires '-A inject'. See the docs for more information.
  -o, --offset <offset>                 Offset to start from
  -d, --delay <delay>                   Pause duration (seconds) between searches (default: 10)
  -e, --include-episodes                Include single-episode torrents in the search (default: false)
  -x, --exclude-older <cutoff>          Exclude torrents first seen more than x minutes ago. Overrides the -a flag.
  -r, --exclude-recent-search <cutoff>  Exclude torrents which have been searched more recently than x minutes ago. Overrides the -a flag.
  -h, --help                            display help for command
```

## Standalone installation

You don't need to install this app, but if

-   you plan on running `cross-seed` regularly
-   you want to control when you receive updates
-   your version of `npm` doesn't support `npx`

you can install it globally:

```shell script
npm install -g cross-seed
```

Then you can run the app with:

```shell script
cross-seed
```

To update,

```shell script
npm uninstall -g cross-seed
npm install -g cross-seed
```

## Daemon mode (beta, rTorrent only, Docker recommended)

`cross-seed` supports a daemon mode, wherein the app is always running, and you
can trigger an HTTP request to search for cross-seeds of a specific torrent. See
more info in the
[wiki page](https://github.com/mmgoodnow/cross-seed/wiki/Daemon-Mode).

## Direct client injection (alpha, rTorrent and qBittorrent only)

As mentioned above, `cross-seed` can inject the torrents it finds directly into
your torrent client. See more info in the
[wiki page](https://github.com/mmgoodnow/cross-seed/wiki/Injection).

## Troubleshooting

First, check the [FAQ](https://github.com/mmgoodnow/cross-seed/wiki/FAQ). If you
still can't figure it out, feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or
[start a discussion](https://github.com/mmgoodnow/cross-seed/discussions/new)
