# HTTP API

`cross-seed` has an HTTP API as part of [Daemon Mode](../basics/daemon.md). When
you run `cross-seed daemon`, the app starts an HTTP server, listening on port
2468 (configurable with the [`port`](options#port) option).

:::danger

`cross-seed` does _not_ have API auth. **Do not expose its port to the
internet.**

:::

## POST `/api/webhook`

This endpoint invokes a search, on all configured trackers, for a specific
torrent name. You can provide the name directly, or you can provide an infoHash,
which `cross-seed` will use to look up the name in your
[`torrentDir`](options#torrentdir). It will respond with `204 No Content` once
it has received your request successfully.

### Supported formats

| `Content-Type`                      | Supported |
| ----------------------------------- | --------- |
| `application/json`                  | ✅        |
| `application/x-www-form-urlencoded` | ✅        |

### Request Payload

```js
POST /api/webhook
{
	// one of { name, infoHash } is required
	name: "<torrent name here>",
	infoHash: "<infoHash of torrent>",
	outputDir: "/path/to/output/dir", // optional
}
```

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  --data-urlencode 'name=<torrent name here>' \
  --data-urlencode 'outputDir=/path/to/output/dir'
```

Alternatively, you can use JSON:

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  -H 'Content-Type: application/json' \
  --data '{"name":"<torrent name here>"}'
```

## POST `/api/announce` (experimental)

Use this endpoint to feed announces into cross-seed. For each announce,
cross-seed will check if the given torrent name matches any torrents you already
have. If found, it will run the matching algorithm to verify that the torrents
do match, and download/inject the announced torrent.

:::tip

This is a real-time alternative to scanning RSS feeds. Consider turning RSS scan
off if you set up this feature.

:::

This endpoint returns 200 if your request was received.

### Supported formats

| `Content-Type`                      | Supported |
| ----------------------------------- | --------- |
| `application/json`                  | ✅        |
| `application/x-www-form-urlencoded` | ✅        |

### Request Payload

```js
POST /api/announce
{
	"name": "string", // torrent name
	"guid": "string", // ideally the torrent's comments/listing url, would be for caching purposes
	"link": "string", // download link
	"size": "number", // in bytes
	"tracker": "string" // this is for logging purposes
}
```
