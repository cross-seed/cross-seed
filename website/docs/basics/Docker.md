---
id: docker
title: Docker
---

`cross-seed` is a pretty standard Node command-line app, so it's pretty
straightforward to run it with Docker.

> Note: the app is controlled by command line arguments, so you'll need to
> specify a command to run, most likely either `search` or `daemon`.

Here's a sample docker-compose blurb, designed to work with daemon mode:

```yaml
version: "2.1"
services:
    cross-seed:
        image: mmgoodnow/cross-seed
        container_name: cross-seed
        user: 1000:1000
        volumes:
            - /path/to/config/folder:/config
            - /path/to/rtorrent_sess:/torrents:ro
            - /path/to/output/folder:/output
        ports:
            - 2468:2468
        command: daemon
```

## Configuration

The first time you run `cross-seed` in a Docker container, it will automatically
create a configuration file at `/config/config.js`. To modify it, map the
`/config` directory and open the file in the editor of your choice.
