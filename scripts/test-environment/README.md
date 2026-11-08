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

The scenarios check:

- First-user setup and authenticated settings changes.
- Invalid stored settings keep authenticated recovery available without
  resetting settings or rotating the API key. Unsafe directory layouts block
  work until a valid settings save resumes indexing; schema errors and malformed
  JSON can be repaired through the online CLI. Invalid legacy files remain
  intact for a complete import after repair and restart.
- Completed client content appearing in Library, including file counts.
- Torznab capabilities, search, and downloaded bencoded metainfo.
- Announces with omitted, distinct URL, and opaque `guid` values: only `link` is
  downloaded, identity is persisted, and cached metainfo can recreate saved
  output when the download URL changes, including after daemon restart.
- Matching and injection using the production qBittorrent adapter, including its
  authentication and multipart request.
- Linked file bytes and matching inode/device, proving a real hardlink.
- Retry after a dropped client connection and successful inventory
  reconciliation.
- Settings changes through the CLI's daemon connection and offline reads after
  shutdown.
- Saved URL prefix and verbosity survive ordinary restarts; explicit CLI flags
  affect only that invocation. Console output reflects saved verbosity, and
  disabled-port CLI options fail without changing saved settings.
- On non-root Linux, a recursive watcher permission exception stays inside its
  worker: HTTP and healthy sources remain available, failed inventory survives,
  restored permissions trigger a rescan, and shutdown drains the watcher
  workers.
- SQLite integrity, inventory rows, and a persisted matching decision after
  clean shutdown.
- Restarting the same database with the session and inventory intact; repeated
  searches do not add the torrent again.
- Exact shared link/data roots rejected before persistence, while nested link
  directories support injection and stay out of source inventory after refresh
  and restart.
- Updated notification webhooks receiving real HTTP result events.
- Enabling, changing and disabling scheduler jobs through HTTP and the online
  CLI, with internally bounded intervals retained after restart.

`daemon.js` owns process lifecycle and HTTP access. `protocols.js` implements
narrow, stateful Torznab and qBittorrent simulators. `scenario.js` drives the
main workflow; `overlap.js` checks source/destination overlap and live
notifications, and `scheduling.js` checks live scheduler settings. They inspect
observable API, client, database, and filesystem results. Assertions do not
depend on diagnostic log messages. Unknown client operations fail instead of
silently pretending to succeed.

This first slice exercises one completed single-file v1 torrent, hardlink mode,
and qBittorrent 5.1 protocol behavior. The simulator does **not** implement a
torrent engine or perform piece verification, and the fixture proves a coherent
request flow rather than compatibility with every real client version. Keep
real-client checks alongside these tests. Follow-up scenarios should cover
mismatches, permissions, incomplete torrents, ambiguous responses after side
effects, other clients, upgrades, and interrupted searches; searches are not yet
durable across process termination. The current test sends POSIX signals and
runs in Linux CI; Windows process lifecycle needs separate coverage.
