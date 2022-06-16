`cross-seed` has a beta feature called daemon mode. I recommend using
[[Docker]].

It starts an HTTP server, listening on port 2468. **_Don't expose this port to
the internet._** It will respond to a POST request with an
`application/x-www-form-urlencoded` or `application/json` body containing the
following parameters:

```json5
{
	// one of { name, infoHash } is required
	name: "<torrent name here>",
	infoHash: "<infoHash of torrent>",
	outputDir: "/path/to/output/dir", // optional
	trackers: ["oink", "tehconnection"], //optional
}
```

While the daemon is running (`cross-seed daemon`), you can trigger a search with
an HTTP request. Note how the `trackers` parameter can take multiple values:

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  --data-urlencode 'name=<torrent name here>' \
  --data-urlencode 'trackers=oink' \
  --data-urlencode 'trackers=tehconnection' \
  --data-urlencode 'outputDir=/path/to/output/dir'
```

Alternatively, you can use JSON:

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  -H 'Content-Type: application/json' \
  --data '{"name":"<torrent name here>",outputDir:"/path/to/output/dir",trackers:["oink","tehconnection"]}'
```

If you are using rTorrent, you can adapt
[these instructions](https://www.filebot.net/forums/viewtopic.php?p=5316#p5316)
to run the `curl` command on finished download.

If you are using qBittorrent, you can use a similar setup with the "Run script
on torrent completion" setting.

### How to run the daemon without docker

If you don't want to use Docker, you can run the `cross-seed` daemon as a
systemd service, or inside a `screen`/`tmux` instance. If you choose to do this,
you will probably want to
[fully install the app](https://github.com/mmgoodnow/cross-seed#standalone-installation).

To start the daemon with `screen`, issue the following command inside a
`screen`:

```shell script
cross-seed daemon
```

Then detach from the screen.
