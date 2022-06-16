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

## Running periodically

I don't really recommend running `cross-seed search` on a schedule as it makes
quite a lot of requests to trackers through Jackett. I recommend using Daemon
Mode instead. If you can't use Daemon mode because you use a different client
than rTorrent, feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or a pull
request and I'll take a look.
