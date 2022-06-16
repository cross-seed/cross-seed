## How do I clear the cache?

`cross-seed clear-cache`

## How do I find a tracker id?

If you go into the Jackett UI, and click the `Copy Torznab Feed` button on a
tracker, your clipboard will look something like this:

```
http://localhost:9117/api/v2.0/indexers/<tracker id>/results/torznab/
```

The tracker id is the part in between `indexers/` and `/results`.

## What can I do about `error parsing torrent at http://…`?

This means that the jacket download link didn't resolve to a torrent file. It's
possible you got rate-limited so you might want to try again in a day or more.
Otherwise, just ignore it. There's nothing cross-seed will be able to do to fix
it.

## How do I find my rTorrent RPC url?

If you use ruTorrent, you most likely have an rtorrent RPC url at
`/path/to/rutorrent/RPC2`. If you don't use ruTorrent then it's likely you'll
have to
[set up the endpoint yourself with a web server](https://github.com/linuxserver/reverse-proxy-confs/blob/77a6dee1318c320900ce3d50390dc8becaf192f7/rutorrent.subfolder.conf.sample#L30-L54).

## Can `cross-seed` connect to rTorrent over an SCGI port or unix socket?

As of right now, no. Feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or a pull
request and I'll take a look.
