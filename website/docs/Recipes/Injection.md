If you use rTorrent or qBittorrent, `cross-seed` can inject the torrents it
finds directly into your torrent client. All you have to do is pass two command
line flags:

```shell script
cross-seed search -A inject --rtorrent-rpc-url http://user:pass@localhost/RPC2
# or
cross-seed search -A inject --qbittorrent-url http://user:pass@localhost:8080
```

It will load the torrent into your client with the label set to `cross-seed` and
start it, fully automatically.

> If you use rTorrent and Docker, you'll need to make sure that your
> `cross-seed` container has read access to the data directories of your
> torrents, mapped to the same path as rTorrent. In order for `cross-seed` to
> prove to rTorrent that a torrent is completed, it must check the modification
> timestamps of all the torrent's files.

## How do I find my rTorrent RPC url?

If you use ruTorrent, you likely have an rtorrent RPC url at
`http://host:port/path/to/rutorrent/RPC2`. If you don't use ruTorrent then it's
likely you'll have to
[set up the endpoint yourself with a web server](https://github.com/linuxserver/docker-rutorrent/issues/122#issuecomment-769009432).

## Can `cross-seed` connect to rTorrent over an SCGI port or unix socket?

As of right now, no. Feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or a pull
request and I'll take a look.

## Can I customize the label per-torrent?

Not at the moment. Feel free to
[open an issue](https://github.com/mmgoodnow/cross-seed/issues/new) or a pull
request and I'll take a look.
