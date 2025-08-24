# cross-seed: Fully-automatic, no false positives

`cross-seed` is a tool that automatically finds and downloads torrents that
are "cross seeds" existing across your other trackers, all based on your
existing torrents and/or data. It is designed to match conservatively to
minimize manual intervention, but is also highly configurable to match your
preferences.

## Supported Clients

`cross-seed` can inject (our terminology for "add") new torrents it finds directly into your torrent client.

Currently, the supported clients are fully supported:

-   rTorrent
-   qBittorrent
-   Transmission
-   Deluge 2.x (limited 1.3.x support)

If your client isn't supported, `cross-seed` will download it's found matching
torrent files to a folder you specify. Following that, you will need to find a
means (or write a script) to add the files to your client.

If you use another client we do not currently support, and would like to help integrate it into
`cross-seed`, [please open an issue here on GitHub to discuss it with us](https://github.com/cross-seed/cross-seed/issues).

## Requirements

-   [Node >= 20](https://nodejs.org/en/download)
-   Indexers that support Torznab or an tracker/indexer manager such as Prowlarr/Jackett (Prowlarr is preferred)

## Tutorial

Head on over to
[cross-seed.org](https://www.cross-seed.org/docs/basics/getting-started) to get
started.

If you are migrating version to the latest available, please read
[the v6 migration guide](https://www.cross-seed.org/docs/v6-migration).

## Troubleshooting

Feel free to
[start a discussion](https://github.com/cross-seed/cross-seed/discussions/new),
or reach out on [Discord](https://discord.gg/jpbUFzS5Wb).

## Development Overview

![Alt](https://repobeats.axiom.co/api/embed/8a8e3b335b4b322f1d37f5981b6de2dad546a730.svg "Repobeats analytics image")d
