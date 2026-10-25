# Daemon test environment

Run the black-box integration test with Node 26:

```sh
npm run test:daemon
```

For a manual, narrated run of the same assertions:

```sh
npm run demo:daemon
```

Both commands compile and launch the actual daemon in a child process. Each run
creates an isolated temporary configuration directory, real SQLite database,
media file, and hardlink destination. A fresh user configures the daemon through
its HTTP API; no application services, database calls, filesystem operations, or
client adapters are replaced. The harness only opens ephemeral loopback ports
and cleans up its processes, servers, and files on completion or failure.

The scenario checks:

- First-user setup and authenticated settings changes.
- Completed client content appearing in Library, including file counts.
- Torznab capabilities, search, and downloaded bencoded metainfo.
- Matching and injection using the production qBittorrent adapter, including its
  authentication and multipart request.
- Linked file bytes and matching inode/device, proving a real hardlink.
- Retry after a dropped client connection and successful inventory
  reconciliation.
- Settings changes through the CLI's daemon connection and offline reads after
  shutdown.
- SQLite integrity, inventory rows, and a persisted matching decision after
  clean shutdown.
- Restarting the same database with the session and inventory intact; repeated
  searches do not add the torrent again.

`daemon.js` owns process lifecycle and HTTP access. `protocols.js` implements
narrow, stateful Torznab and qBittorrent simulators. `scenario.js` drives the
workflow and checks observable API, client, database, and filesystem results.
Assertions do not depend on diagnostic log messages. Unknown client operations
fail instead of silently pretending to succeed.

This first slice exercises one completed single-file v1 torrent, hardlink mode,
and qBittorrent 5.1 protocol behavior. The simulator does **not** implement a
torrent engine or perform piece verification, and the fixture proves a coherent
request flow rather than compatibility with every real client version. Keep
real-client checks alongside these tests. Follow-up scenarios should cover
mismatches, permissions, incomplete torrents, ambiguous responses after side
effects, other clients, upgrades, and interrupted searches; searches are not yet
durable across process termination. The current test sends POSIX signals and
runs in Linux CI; Windows process lifecycle needs separate coverage.
