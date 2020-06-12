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

You need [node.js](https://nodejs.org/en/download) and npm for this app. It will
work on Mac and on Linux; I haven't tested it on Windows but it probably works
there too.

I targeted Node v10, it may work on v8, definitely won't on v6.

## Usage

Invoking it is _almost_ as simple as:

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
  -d, --delay <delay>             Pause duration between searches
  -t, --trackers <tracker>         Jackett tracker id to search
  -i, --torrent-dir <dir>         Directory with torrent files
  -s, --output-dir <dir>          Directory to save results in
  -o, --offset <offset>           Offset to start from
  -h, --help                      display help for command
```

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
after that, you won't have to specify them on the command line any more.

To create a configuration file, run

```shell script
cross-seed gen-config
```

Then you can edit the file using your editor of choice.
