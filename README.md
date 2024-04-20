# cross-seed: Fully-automatic, no false positives

`cross-seed` is an app designed to help you download torrents that you can cross
seed based on your existing torrents. It is designed to match conservatively to
minimize manual intervention.

`cross-seed` can inject the torrents it finds directly into your torrent client.
Currently, the supported clients are

-   rTorrent
-   qBittorrent
-   Transmission
-   Deluge

If your client isn't supported, `cross-seed` will download a bunch of torrent
files to a folder you specify. After that, I recommend using
[AutoTorrent2](https://github.com/JohnDoee/autotorrent2) to do the last-mile
delivery into your client.

## 🚨🚨🚨 Breaking changes in cross-seed v6 🚨🚨🚨

Head on over to the
[v6 migration guide](https://www.cross-seed.org/docs/v6-migration-guide)
to see the steps required for migration.
 
## Requirements

-   [Node >= 20](https://nodejs.org/en/download)
-   Any number of indexers that support Torznab (use Jackett or Prowlarr to
    help)

## Tutorial

Head on over to
[cross-seed.org](https://www.cross-seed.org/docs/basics/getting-started) to get
started.

## Troubleshooting

Feel free to
[start a discussion](https://github.com/cross-seed/cross-seed/discussions/new),
or reach out on [Discord](https://discord.gg/jpbUFzS5Wb).
