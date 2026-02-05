# cross-seed: Fully-automatic cross-seeding

`cross-seed` is an app designed to help you download torrents that you can cross
seed based on your existing torrents. It is designed to match conservatively to
minimize manual intervention.

## Requirements

- [Node >= 24](https://nodejs.org/en/download)
- Any indexers that support Torznab (through Prowlarr or Jackett)
- At least one torrent client: rTorrent, qBittorrent, Deluge, or Transmission

## Tutorial

Head on over to
[cross-seed.org](https://www.cross-seed.org/docs/basics/getting-started) to get
started.

## Troubleshooting

Feel free to
[start a discussion](https://github.com/cross-seed/cross-seed/discussions/new),
or reach out on [Discord](https://discord.gg/jpbUFzS5Wb).

## Releases and Branches

cross-seed roughly follows semantic versioning. Every release has a
corresponding git tag. Git branches do not represent released code.

Versions that look like v0.0.0 are _releases_ and are considered stable.
Versions that look like v0.0.0*-0* are _prereleases_ and are not considered
stable.

We also publish Docker images at `ghcr.io/cross-seed/cross-seed` under several
tag patterns: `:branch`, `:6`, `latest`.

- `latest` - the most recent _release_.
- `prerelease` - the most recent _release_ or _prerelease_.
- `master` - The main development branch. Code that is intended for release, but
  has not necessarily released yet. This is similar to `prerelease` but gets new
  code first so is slightly more bleeding edge.
- `nightly` - for open experimental PRs. Not always used and may fall behind
  master.
