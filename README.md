# cross-seed

`cross-seed` is an app designed to help you download torrents that you can cross
seed based on your existing torrents. It will only find torrents whose file
contents exactly match the file contents of the input torrents. This means that
`.nfo` files have a high likelihood of causing a rejection.

`cross-seed` will download a bunch of torrent files to a folder you specify.
After that, I recommend using
[AutoTorrent](https://github.com/JohnDoee/autotorrent) to do the last-mile
delivery into your client.

## Requirements

-   [Node 10+](https://nodejs.org/en/download)
-   [Jackett](https://github.com/Jackett/Jackett)

It will work on Mac and on Linux; I haven't tested it on Windows but it probably
works there too.

## Usage

Invoking `cross-seed` is _almost_ as simple as:

```shell script
npx cross-seed
```

Here's an example invocation:

```shell script
npx cross-seed search -u http://localhost:9117/jackett -k JACKETT_API_KEY -d 10 -t all -i /home/rtorrent/.session -s /tmp/torrents
```

You either need to give it a lot of command-line arguments or create a
[configuration file](#configuration).

```text
Usage: cross-seed search [options]

Search for cross-seeds


Options:
  -u, --jackett-server-url <url>  Your Jackett server url
  -k, --jackett-api-key <key>     Your Jackett API key
  -d, --delay <delay>             Pause duration (seconds) between searches
                                  (default: 10)
  -t, --trackers <tracker>        Comma-separated list of Jackett tracker ids
                                  to search
  -i, --torrent-dir <dir>         Directory with torrent files
  -s, --output-dir <dir>          Directory to save results in
  -o, --offset <offset>           Offset to start from (default: 0)
  -e, --include-episodes          Include single-episode torrents in the search
                                  (default: false)
  -h, --help                      display help for command
```

## Daemon Mode (rtorrent only, Docker recommended)

`cross-seed` has a new feature called daemon mode. It starts an HTTP server,
listening on port 2468. It will respond to a POST request with a plaintext body
containing the name of a torrent inside your torrent directory. As of right now
it only works with rtorrent. I recommend using Docker if you plan to use
cross-seed in daemon mode.

### Docker

Here's a sample docker-compose blurb:

```yaml
version: "2.1"
services:
    cross-seed:
        image: mmgoodnow/cross-seed:daemon
        container_name: cross-seed
        # not a bad idea to set this to a user that has read-only privileges
        # to your rtorrent_sess folder and everything inside it
        user: 1000:1000
        volumes:
            - /path/to/config/folder:/config
            - /path/to/rtorrent_sess:/torrents
            - /path/to/output/folder:/output
        ports:
            - 2468:2468
```

While the daemon is running, you can trigger a search with an HTTP
request:

```shell script
curl -XPOST http://localhost:2468/api/webhook --data '<torrent name here>'
```

If you are using rtorrent, you can adapt
[these instructions](https://www.filebot.net/forums/viewtopic.php?p=5316#p5316)
to run the `curl` command on finished download.

### How to run the daemon without docker

If you don't want to use Docker, you can run the `cross-seed` daemon as a
systemd service, or inside a `screen` instance. If you choose to do this, you
will probably want to [fully install the app](#install).

To start the daemon, issue the following command inside a `screen`:

```shell script
cross-seed daemon
```
Then detach from the screen.

## Install

You don't need to install this app, but if you really want to, or if your
version of `npm` doesn't support `npx`, you can install it globally:

```shell script
npm install -g cross-seed
```

Then you can run the app with:

```shell script
cross-seed
```

To update,

```shell script
npm update -g cross-seed
```

## Configuration

`cross-seed` will look for a configuration file at `~/.cross-seed/config.js`
(`AppData\Local\cross-seed\config.js` on Windows). In the configuration file ,
you can specify all of the same flags you specified on the command line, but
after that, you won't have to specify them on the command line any more. If you
would like to use a different directory than the default, you can set the
`CONFIG_DIR` environment variable.

To create a configuration file, run

```shell script
cross-seed gen-config
```

Then you can edit the file using your editor of choice.
