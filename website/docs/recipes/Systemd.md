---
id: systemd
title: systemd
---

```
[Unit]
Description=Cross Seed Search Daemon
After=network.target qbittorrent jackett
Wants=network-online.target qbittorrent jackett
[Service]
User={user}
Group={group}
Restart=always
Type=simple
ExecStart=cross-seed daemon
[Install]
WantedBy=multi-user.target
```

Direct questions/support to https://github.com/mmgoodnow/cross-seed/issues/159
