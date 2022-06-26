---
id: getting-started
title: Getting Started
sidebar_position: 0
---

Here we will install `cross-seed` and run our first search.

## Installation

### with Docker (recommended)

```
docker run mmgoodnow/cross-seed --version
```

### with `npm`

Requires [node](https://nodejs.org/en/download/) 14 or greater.

```shell
npm install -g cross-seed
cross-seed --version
```

### with `yarn`

Requires [node](https://nodejs.org/en/download/) 14 or greater.

```shell
yarn global add cross-seed
cross-seed --version
```

### with Unraid

In Unraid, you can install cross-seed from Docker Hub with the Community
Applications app. Check out the [Unraid guide](../recipes/Unraid) for details.

## Running your first search

To get started, we'll use the following command:

```shell
# one liner
cross-seed search -o . --torrent myTorrentFile.torrent --torznab https://localhost/prowlarr/1/api?apikey=12345
# readable
cross-seed search \
  -o . \ # any directory
  --torrent myTorrentFile.torrent \ # seperated by spaces
  --torznab https://localhost/prowlarr/1/api?apikey=12345 # any valid torznab link, separated by spaces
```

If you were lucky, you've already got your first cross-seed!

:::tip

`cross-seed` has two subcommands: `search` and `daemon`.

`search` (used above) will scan each torrent you provide and look for
cross-seeds, then exit.

`daemon` will run forever, and can be configured to run searches periodically,
watch RSS, and search for newly finished downloads.

:::
