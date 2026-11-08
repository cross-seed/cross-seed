---
id: common-setup-failures
sidebar_position: 4
title: Common Setup Failures
---

Start here for path, mount, networking, Torznab URL, permission, recovery, and
cleanup-scope problems.

## Invalid settings in v7

The v7 daemon keeps its authenticated Web UI available when stored settings are
invalid. A recovery banner explains the error. Searches, indexing, and injection
stay paused; API requests that would start work return HTTP 503.

For a directory layout error, open **Settings → Directories**, correct the
paths, and save. A link directory can be inside a data directory, but they must
not be the same directory, including through symlink aliases. A successful
repair resumes the daemon automatically; changing the HTTP address, port, or URL
prefix still requires a restart.

If stored settings contain invalid values or malformed JSON, the UI provides a
JSON repair editor. It shows the original stored text, including secrets. A
successful save replaces settings after validation; it does not replace users,
indexers, or history. Preserve the API key in the repaired settings to keep
existing integrations working. Failed validation leaves the stored text intact.

If a legacy `config.js` import fails, fix the original file and restart to retry
the complete import, including indexers. Recovery mode does not replace an
unsuccessful import with default settings.

This mode requires a readable SQLite database and a usable HTTP listener. It
cannot repair a corrupt database or bind an occupied port. Back up the database
before offline recovery; do not delete it to reset settings.

## Docker paths and mounts

`cross-seed` and your torrent client must see the same data at the same path.
There is no path remapping layer in `cross-seed`.

If qBittorrent says a torrent is saved at `/data/torrents/movies/Movie`, then
the `cross-seed` container must also be able to access that same file at
`/data/torrents/movies/Movie`. If Deluge says the save path is
`/downloads/tv/Show`, then `cross-seed` must also see `/downloads/tv/Show`.

### Working Docker Compose pattern

Mount the same host path at the same container path in qBittorrent, the Arrs,
and `cross-seed`:

```yaml
services:
    qbittorrent:
        image: lscr.io/linuxserver/qbittorrent
        volumes:
            - /mnt/user/data:/data

    radarr:
        image: lscr.io/linuxserver/radarr
        volumes:
            - /mnt/user/data:/data

    sonarr:
        image: lscr.io/linuxserver/sonarr
        volumes:
            - /mnt/user/data:/data

    cross-seed:
        image: ghcr.io/cross-seed/cross-seed:6
        container_name: cross-seed
        user: 1000:1000
        ports:
            - "2468:2468"
        volumes:
            - /mnt/user/appdata/cross-seed:/config
            - /mnt/user/data:/data
        command: daemon
```

Then use paths under `/data` everywhere:

```js
module.exports = {
	torrentClients: ["qbittorrent:http://user:pass@qbittorrent:8080"],
	dataDirs: ["/data/media/movies", "/data/media/tv"],
	linkDirs: ["/data/torrents/cross-seed"],
};
```

### Broken Docker Compose pattern

This exposes the same host tree at different container paths:

```yaml
qbittorrent:
    volumes:
        - /mnt/user/data/torrents:/downloads

cross-seed:
    volumes:
        - /mnt/user/data:/data
```

If qBittorrent reports `/downloads/Movie`, `cross-seed` will look for
`/downloads/Movie`. It will not translate that to `/data/torrents/Movie`.

### Hardlinks across Docker mounts

Hardlinks and reflinks must be created within the same filesystem mount. In
Docker, separate volume declarations are separate mount points from the
container's point of view, even when they are on the same host disk.

This will often fail for hardlinks:

```yaml
volumes:
    - /mnt/user/data/torrents:/torrents
    - /mnt/user/data/cross-seed:/cross-seeds
```

Prefer one shared parent:

```yaml
volumes:
    - /mnt/user/data:/data
```

Then set `linkDirs` to a path under that same mount:

```js
linkDirs: ["/data/cross-seed"],
```

## Diagnosing path and linking errors

Use these checks from inside the `cross-seed` container:

```shell
docker exec -it cross-seed sh
ls -la /data/torrents
ls -la /data/torrents/path/from/client
touch /data/torrents/.cross-seed-write-test
rm /data/torrents/.cross-seed-write-test
```

If `ls` cannot find the path that your torrent client reports, fix the mounts or
save paths first.

| Symptom                        | Check first                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `Linking failed ... not found` | `cross-seed` cannot see the source file at the client-reported path, or the source torrent is missing files. |
| `invalid data`                 | The path points at the wrong file/folder, or the file is not the expected torrent data.                      |
| Injected torrent stays at `0%` | The torrent client cannot see the linked data at the injected save path.                                     |
| `EXDEV` or hardlink failure    | Source and destination are on different filesystems or different Docker mounts.                              |

## Torznab and Prowlarr URLs

The `torznab` option needs each indexer's Torznab endpoint, not the base
Prowlarr API URL.

In Prowlarr, open the indexer and copy the Torznab/RSS URL for that indexer. The
URL should include the indexer ID before `/api`.

Correct:

```text
http://prowlarr:9696/1/api?apikey=YOUR_KEY
http://prowlarr:9696/2/api?apikey=YOUR_KEY
```

Wrong:

```text
http://prowlarr:9696/api?apikey=YOUR_KEY
http://prowlarr:9696/api/v1/indexer?apikey=YOUR_KEY
```

`responded with invalid XML` usually means the URL returned JSON or HTML instead
of Torznab XML. Check for a Prowlarr JSON API URL, login page, reverse proxy
error page, or wrong indexer path.

From inside Docker, `127.0.0.1` and `localhost` mean "this container", not
"another container". Use the service name, such as `http://prowlarr:9696`, when
both containers share a Docker network.

## Docker networking and webhooks

Test the exact network path with `/api/ping` before configuring qBittorrent,
Deluge, autobrr, or an Arr import script.

From another container on the same Docker network:

```shell
curl http://cross-seed:2468/api/ping
```

From the host, if port `2468` is published:

```shell
curl http://localhost:2468/api/ping
```

From another machine on your LAN:

```shell
curl http://192.168.1.10:2468/api/ping
```

Choose the base URL from the caller's network context:

| Caller                                                     | Usually use                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| qBittorrent in the same Compose network                    | `http://cross-seed:2468`                                         |
| qBittorrent sharing the same Gluetun/VPN network namespace | `http://localhost:2468` if `cross-seed` is in that namespace too |
| qBittorrent on the Docker host                             | `http://localhost:2468`                                          |
| qBittorrent on another LAN host                            | `http://HOST_LAN_IP:2468`                                        |
| qBittorrent in a different Docker network                  | Put both containers on a shared network or use the host LAN IP   |

Common `curl` errors:

- `Could not resolve host`: the hostname is not visible from where `curl` runs.
  Use the Compose service name on a shared Docker network, or an IP address.
- `Connection refused`: the host resolved, but nothing is listening there or the
  port is not published/reachable.
- `401 Unauthorized`: `/api/ping` works, but protected endpoints need the API
  key. Run `cross-seed api-key` and include `?apikey=...` or `X-Api-Key`.

Do not expose the `cross-seed` API to the public Internet.

## Config and permissions

Let `cross-seed` generate `config.js` first, then edit the generated file.

If edits do not stick:

- Confirm you are editing the active config directory.
- Check that the container user can read and write `/config`.
- On Docker, set `user:` to the same UID and GID as your torrent client.
- On Unraid, check appdata permissions and the template's host paths.
- On Synology or Unraid, avoid editors that save through a temporary file with
  different ownership.
- Restart `cross-seed` after editing `config.js`.

If `config.js` is invalid JavaScript, startup will fail. Fix the syntax error
instead of deleting the config or database.

## Before asking for help

Include these when asking for help:

- `cross-seed` version.
- Install method: Docker, Unraid, npm, seedbox package, or other.
- Torrent client and version.
- Redacted `config.js`.
- Startup logs.
- `<config dir>/logs/verbose.current.log`.
- Exact command or webhook URL used.
- Docker Compose, Unraid template, or seedbox topology if applicable.
- The save path shown by the torrent client for one affected torrent.

Redact API keys, passkeys, usernames, passwords, and tracker domains.
