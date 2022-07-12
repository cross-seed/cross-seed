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
[AutoTorrent2](https://github.com/JohnDoee/autotorrent2) to do the last-mile
delivery into your client.

## 🚨🚨🚨 Breaking changes in cross-seed v4 🚨🚨🚨

Head on over to https://github.com/mmgoodnow/cross-seed/wiki/v4-Migration-Guide
to see the steps required for migration.

## Requirements

-   [Node 14+](https://nodejs.org/en/download)
-   Any number of indexers that support Torznab (use Jackett or Prowlarr to
    help)

## Tutorial

Head on over to
[cross-seed.org](https://www.cross-seed.org/docs/basics/getting-started)

## Troubleshooting

First, check the [FAQ](https://github.com/mmgoodnow/cross-seed/wiki/FAQ). If you
still can't figure it out, feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or
[start a discussion](https://github.com/mmgoodnow/cross-seed/discussions/new)
