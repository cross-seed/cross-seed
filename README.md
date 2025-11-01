# cross-seed: Fully-automatic cross-seeding

`cross-seed` automatically finds and downloads torrents that
are "cross seeds" existing across your other trackers, all based on your
existing torrents and/or data. It is designed to match conservatively to
minimize manual intervention, but is also highly configurable to match your
preferences.

## Torrent Client Integration

`cross-seed` can inject new torrents it finds directly into your torrent client. 

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

## Branches and Releases

The docs are updated when a new release is made, `pre-release` is not a release by definition.

## Github Branches
- Tagged Pre-Release releases are betas and align to the `master` release branch
- `master` Github Development Branch is equivalent to nightly/bleeding edge.

## Docker Release Tags

 - `:nightly` - for open PRs, implementation could change after review
 - `:master` - for pre-release - _tagged GitHub releases_ - testing
 - `:latest` - for tagged releases
