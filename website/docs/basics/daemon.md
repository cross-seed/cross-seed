---
id: daemon
sidebar_position: 1
title: Daemon Mode
---

Daemon Mode lets you harness the full power of `cross-seed`, by:

-   instantly searching for cross-seeds for finished downloads
-   watching for new releases:
    -   scanning RSS feeds periodically
    -   listening for new release announces and snatching them if you already
        have the data
-   Running batch searches on your full collection of torrents periodically

:::tip

In theory, after you run a full-collection search for the first time, just the
first 2 features should be able to find all cross-seeds as soon as possible.
However there are applications for the third feature as well. If improvements in
the matching algorithm are made to `cross-seed`, or your daemon is down for an
amount of time, running searches very infrequently will find cross-seeds which
fell through the cracks.

:::

In this doc, we'll go through strategies to run the daemon continuously and
start automatically on reboot, ways to trigger searches for torrents that just
finished downloading, and ways to watch for new releases.

:::danger

`cross-seed` does _not_ have API auth. **Do not expose its port to the
internet.**

:::

## Running the daemon continuously

The easiest way to run the daemon is just to leave a terminal open after running
the following command:

```shell
cross-seed daemon
```

However, that's not very sustainable.

-   If you run `cross-seed` on a server that you use `ssh` to log into, then
    `cross-seed` will stop whenever your `ssh` session closes.
-   If the server restarts, then you'll have to start `cross-seed` manually.

Below are a few ways you can set up `cross-seed daemon` to run on its own:

-   [Docker](#docker)
-   [`systemd`](#systemd-linux)
-   [`screen`](#screen)

### Docker

You can use [**Docker Compose**](https://docs.docker.com/compose/install).
Create or open your existing `docker-compose.yml` file and add the `cross-seed`
service:

```yaml
version: "2.1"
services:
    cross-seed:
        image: mmgoodnow/cross-seed
        container_name: cross-seed
        user: 1000:1000 # optional but recommended
        ports:
            - "2468:2468" # you'll need this if your torrent client runs outside of Docker
        volumes:
            - /path/to/config/folder:/config
            - /path/to/rtorrent_sess:/torrents:ro # note that this volume can and should be mounted read-only
            - /path/to/output/folder:/output
        command: daemon # this enables the daemon
        restart: unless-stopped
```

After that, you can use the following commands to control it:

```shell
docker-compose pull # Update the container to the latest version of cross-seed
docker-compose up -d # Create/start the container
docker start cross-seed # Start the daemon
docker stop cross-seed # Stop the daemon
docker restart cross-seed # Restart the daemon
docker logs cross-seed # view the logs
```

### `systemd` (Linux)

If you want to use `systemd` to run `cross-seed daemon` continuously, you can
create a unit file in `/etc/systemd/system`.

```shell
touch /etc/systemd/system/cross-seed.service
```

Open the file in your favorite editor, and paste the following code in. You'll
want to customize the following variables:

-   `{user}`: your user, or another user if you want to create a separate user
    for `cross-seed`
-   `{group}`: your group, or another group if you want to create a separate
    group for `cross-seed`
-   `/path/to/node`: run the command `which node` in your terminal, then paste
    the output here.

```unit file (systemd)
[Unit]
Description=cross-seed daemon
[Service]
User={user}
Group={group}
Restart=always
Type=simple
ExecStart=/path/to/node cross-seed daemon
[Install]
WantedBy=multi-user.target
```

After installing the unit file, you can use these commands to control the
daemon:

```shell
sudo systemctl daemon-reload # tell systemd to reindex to discover the unit file you just created
sudo systemctl enable cross-seed # enable it to run on restart
sudo systemctl start cross-seed # start the service
sudo systemctl stop cross-seed # stop the service
sudo systemctl restart cross-seed # restart the service
sudo journalctl -u cross-seed # view the logs
```

### `screen`

`screen` is a **terminal multiplexer**.

> A Terminal multiplexer is a program that can be used to multiplex login
> sessions inside the Terminal. This allows users to have multiple sessions
> inside a single Terminal window. One of the important features of the Terminal
> multiplexer is that users can attach and detach these sessions.
>
> Source: https://linuxhint.com/tmux_vs_screen/

Running a long-lived `cross-seed daemon` process in `screen` is very easy.

```shell
screen -S cross-seed -d -m cross-seed daemon
```

The above command will start a `screen` instance named `cross-seed` in
`detached` mode, running the `cross-seed daemon` command at launch.

To attach to the `screen`, run the following command:

```shell
screen -r cross-seed
```

Once attached, you can detach with `ctrl-A, D`.

## Set up automatic searches for finished downloads

The most powerful feature of Daemon Mode is the ability to search for
cross-seeds as soon as a torrent finishes downloading. However, it requires some
manual setup.

### rTorrent

For rTorrent, you'll have to edit your `.rtorrent.rc` file.

1.  `cd` to the directory where `.rtorrent.rc` lives.
2.  Create a file called `rtorrent-cross-seed.sh`. It should contain the
    following contents:

    ```shell
    #!/bin/sh
    curl -XPOST http://localhost:2468/api/webhook --data-urlencode 'name=$1'
    ```

:::tip Docker users

You can use `http://cross-seed:2468` instead of `http://localhost:2468` with
Docker networks.

:::

3.  Run the following command (this will give rTorrent permission to execute
    your script):

    ```shell
    chmod +x rtorrent-cross-seed.sh
    ```

4.  Run the following command (this will tell rTorrent to execute your script :
    ```shell
    echo 'method.set_key=event.download.finished,cross_seed,"execute={'`pwd`/rtorrent-cross-seed.sh',$d.name=}"' >> .rtorrent.rc
    ```

### qBittorrent

1. In the **qBittorrent** Web UI, navigate to Tools > Options > Downloads.
2. Check the **Run external program on torrent completion** box and enter the
   following in the box:
    ```shell
    curl -XPOST http://localhost:2468/api/webhook --data-urlencode "name=%N"
    ```

:::tip

If you are already using the **Run external program on torrent completion** box,
you can separate the two commands with a semicolon:

```shell
    oldcommand %N; curl -XPOST http://localhost:2468/api/webhook --data-urlencode "name=%N"
```

:::

## Set up RSS

Setting up RSS is very easy. Just open your config file, and set the
[`rssCadence`](../reference/options#rsscadence) option. I recommend 10 minutes:

```js
rssCadence: "10 minutes",
```

## Set up periodic searches

Setting up periodic searches is very easy. Just open your config file, and set
the [`searchCadence`](../reference/options#searchcadence) option. I recommend 26
weeks (biannual):

```js
searchCadence: "26 weeks",
```

You can also combine `searchCadence` with `excludeRecentSearch` and run it more
frequently for a smoother load:

```js
searchCadence: "1 week",
excludeRecentSearch: "26 weeks",
```
