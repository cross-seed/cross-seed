---
id: injection
sidebar_position: 1
title: Direct Client Injection
---

If you use **rTorrent** or **qBittorrent**, `cross-seed` can inject the torrents
it finds directly into your torrent client. This satisfies most simple use
cases. For more complex cases,
[**autotorrent2**](https://github.com/JohnDoee/autotorrent2) or
[**qbit_manage**](https://github.com/StuffAnThings/qbit_manage) is recommended.

## `rTorrent` setup

`cross-seed` will inject torrents into **rTorrent** with a `cross-seed` label.

1. Make sure **rTorrent** has access to your `outputDir` (if Docker, make sure
   they're mapped to the same path).
2. Edit your config file:
    1. Set your [`action`](../reference/options#action) option to `inject`.
    2. Set your [`rtorrentRpcUrl`](../reference/options#rtorrentrpcurl) option.
       It should look like an `http` url that looks like
       `http://user:pass@localhost:8080/rutorrent/RPC2` (if you have ruTorrent
       installed). See the [reference](../reference/options#rtorrentrpcurl) for
       more details.
3. Start or restart `cross-seed`. The logs at startup will tell you if
   `cross-seed` was able to connect to rTorrent.

:::tip Docker users

In order for `cross-seed` to prove to **rTorrent** that a torrent is completed,
it must check the modification timestamps of all the torrent's files.

Make sure that your `cross-seed` container has **read** access to the **data
directories** of your torrents, mapped to the same path as **rTorrent**.

:::

## `qBittorrent` setup

:::caution

Injection will work best if you use the `Original` content layout.

:::

2. Edit your config file:
    1. Set your [`action`](../reference/options#action) option to `inject`.
    2. Set your [`qbittorrentUrl`](../reference/options#qbittorrenturl) option.
       It should look like an `http` url that looks like
       `http://user:pass@localhost:8080(/qbittorrent)` See the
       [reference](../reference/options#qbittorrenturl) for more details.

:::caution Sonarr users

There is a bad interaction with `cross-seed`, **qBittorrent**, and **Sonarr**,
where new cross-seeds will be added with the Sonarr category, and then get stuck
in Sonarr's import queue. There is a
[fix in progress](https://github.com/cross-seed/cross-seed/pull/257), which will
work if:

-   you don't use separate **pre/post import categories** in Sonarr
-   Sonarr's **pre/post import categories** have the same **save path** in
    qBittorrent.

:::
