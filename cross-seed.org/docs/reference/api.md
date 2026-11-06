# HTTP API

`cross-seed` has an HTTP API as part of
[Daemon Mode](../basics/managing-the-daemon). When you run the
`cross-seed daemon` command, the app starts an HTTP server, listening on port
2468 (configurable with the [`port`](../basics/options#port) option).

:::tip

The two main endpoints you will be using are covered by the
[`Announce Matching`](../tutorials/announce.md) and
[`Triggering Searches`](../tutorials/triggering-searches.md) tutorials.

:::

## Authorization

You can specify an API key using the [`apiKey`](../basics/options.md#apikey)
option, or let `cross-seed` generate one for you (default).

To find your generated API key, run the `cross-seed api-key` command. The API
key can be included with your requests in either of two ways:

```shell
# provide api key as a query param
curl -XPOST localhost:2468/api/webhook?apikey=YOUR_API_KEY --data-urlencode ...
# provide api key as an HTTP header
curl -XPOST localhost:2468/api/webhook -H "X-Api-Key: YOUR_API_KEY" --data-urlencode ...
```

If `cross-seed` runs in Docker, run `cross-seed api-key` inside that container
or use the same config directory as the daemon. If `apiKey` is explicitly set in
`config.js`, restart the daemon and use that configured key.

## GET `/api/ping`

This endpoint will respond with `200 OK` if the daemon is running. There is no
authorization on this endpoint.

### Request Payload

```shell script
curl http://localhost:2468/api/ping
```

Use this endpoint first when debugging Docker, VPN, or webhook networking. It
does not require authentication, so a failed ping means the request cannot reach
the daemon. See
[Docker networking and webhooks](../basics/common-setup-failures.md#docker-networking-and-webhooks).

## POST `/api/webhook`

This endpoint invokes a search, on all configured trackers, for a specific
torrent infoHash or torrent data. `cross-seed` will either look up the torrent
in your client or parse the filename directly. It will respond with
`204 No Content` once it has received your request successfully.

:::tip

Searches that match a torrent file always take precedence, even in data-based
searching.

:::

### Supported formats

| `Content-Type`                      | Supported |
| ----------------------------------- | --------- |
| `application/json`                  | ✅        |
| `application/x-www-form-urlencoded` | ✅        |

### Request Payload

```js
POST /api/webhook
{
    // infoHash or path is required but not both (infoHash is recommended)
    infoHash: "<infoHash of torrent>",
    path: "/path/to/torrent/file.mkv",
    // All of the following are optional with their defaults shown
    // undefined defaults to your config
    ignoreCrossSeeds: true,
    ignoreExcludeRecentSearch: false,
    ignoreExcludeOlder: false,
    ignoreBlockList: false,
    includeSingleEpisodes: undefined,
    includeNonVideos: undefined,
}
```

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  --data-urlencode 'infoHash=<torrent infoHash here>' \
  --data-urlencode 'path=/path/to/torrent/file.mkv' \
  --data-urlencode 'includeSingleEpisodes=true'
```

:::note

`-d` can be used instead of --data-urlencode for all options except `path`.

:::

Alternatively, you can use JSON:

```shell script
curl -XPOST http://localhost:2468/api/webhook \
  -H 'Content-Type: application/json' \
  --data '{"infoHash":"<torrent infoHash here>"}'
```

## POST `/api/announce`

:::tip

[**How to configure matches from announce?**](../tutorials/announce.md)

:::

Use this endpoint to feed announces into cross-seed. For each `announce`,
`cross-seed` will check if the provided search criteria match any torrents you
already have. If found, it will run our matching algorithm to verify that the
torrents do indeed match, and inject the announced torrent.

:::info

This is a _real-time_ alternative to scanning RSS feeds via
[`rssCadence`](../basics/options.md#rsscadence). Consider turning the RSS scan
off ([`rssCadence: null,`](../basics/options.md#rsscadence)), or significantly
raising the time if you set up this feature.

:::

This endpoint returns `200` if your request was received and a completed match
was found in your client, if a match was found to be incomplete (still
downloading) then `cross-seed` will return the status code `202`, and if no
match was found `cross-seed` will respond with a `204 No Content`.

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
    "link": "string", // required torrent download URL
    "guid": "string", // v7: optional stable identifier; defaults to link
    "tracker": "string" // used for linking path and logging
}
```

In v7, `guid` identifies the torrent for caching; `link` is the URL cross-seed
downloads. They may differ. If you supply a `guid`, use a nonblank, stable,
globally unique identifier for that torrent, such as its tracker details URL. It
does not need to be a URL. Existing integrations that send the download URL for
both fields continue to work.

For v6, continue to send the download URL for both `guid` and `link`.

## POST `/api/job`

This endpoint allows you to trigger an early run of a specified job. For the
`search` and `rss` jobs, the next scheduled run for the job will be double its
normal cadence if the request was successful. You will be able to perform
another early run once the next scheduled run is closer than its regular cadence
away. When triggered for the `cleanup` job, it will always run all cleanup tasks
to bypass their internal scheduling.

If the job is not enabled due to your config (e.g
[`searchCadence`](../basics/options#searchcadence) is set to `null`)
`cross-seed` will respond with `404 Not Found`. If the job is currently running,
or its scheduled run is further away than its config.js configured cadence,
`cross-seed` will respond with `409 Conflict`. If the job was successfully
triggered, `cross-seed` will respond with `200 OK`.

### Supported formats

| `Content-Type`                      | Supported |
| ----------------------------------- | --------- |
| `application/json`                  | ✅        |
| `application/x-www-form-urlencoded` | ✅        |

### Request Payload

```js
POST /api/job
{
    // Job name is required
    name: "cleanup | inject | rss | search | updateIndexerCaps",
    // All of the following are optional with their defaults shown
    ignoreExcludeRecentSearch: false,
    ignoreExcludeOlder: false,
}
```

```shell script
curl -XPOST http://localhost:2468/api/job \
  -d 'name=search' \
  -d 'ignoreExcludeRecentSearch=true' \
  -d 'ignoreExcludeOlder=true'
```

Alternatively, you can use JSON:

```shell script
curl -XPOST http://localhost:2468/api/job \
  -H 'Content-Type: application/json' \
  --data '{"name": "updateIndexerCaps"}'
```
