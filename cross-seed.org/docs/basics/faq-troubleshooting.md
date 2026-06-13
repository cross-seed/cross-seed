---
id: faq-troubleshooting
title: FAQ & Troubleshooting
sidebar_position: 5
---

### Updating to cross-seed v6

If you are updating from version 5.x to version 6.x, you can visit the
[v6 migration guide](../v6-migration) for the changes and updates.

### General Suggestions

- The log files in `cross-seed`'s `logs` folder—specifically `verbose.*.log`—are
  your friend. If you experience undesired results from `cross-seed`, look to
  these files first for indicators of why `cross-seed` performed the way it did.
- If you are debugging Docker paths, hardlinks, Torznab URLs, webhooks,
  permissions, or recovery, start with
  [Common Setup Failures](./common-setup-failures.md).
- In the past, `cross-seed` has been less opinionated about what settings work
  well. After a few years of experimentation, we have settled on a
  high-performing set of default settings that should work well for users and
  trackers alike. If your configuration predates v6, consider adjusting your
  settings to match the
  [defaults](https://raw.githubusercontent.com/cross-seed/cross-seed/v6.13.6/src/config.template.cjs).

### Windows Paths

Windows users, for all paths in your configuration file, use "\\\\" instead of
"\\".

```js
torrentDir: "C:\\Path\\To\\Torrents",
outputDir: "C:\\My Data\\.cross-seed",
linkDirs: ["C:\\My Data\\Downloads\\MyLinkDir"],
dataDirs: ["C:\\My Data\\Downloads\\Movies"],
```

For a full native Windows setup, see the [Windows quickstart](./windows.md).

### Where is the config directory for `cross-seed`?

The config directory for `cross-seed` is located in the following locations:

| Platform  | Path                                               |
| --------- | -------------------------------------------------- |
| `Windows` | `C:\Users\<YourUsername>\AppData\Local\cross-seed` |
| `MacOS`   | `/Users/<YourUsername>/.cross-seed`                |
| `Linux`   | `/home/<YourUsername>/.cross-seed`                 |
| `Docker`  | `/config`                                          |

:::tip

If you would like to use a custom config directory, you can set the `CONFIG_DIR`
environment variable.

:::

### How do I find the config file for `cross-seed`?

The config file for `cross-seed` called `config.js` is located in the config
directory described above. For instructions on creating and editing the config
file, use the
[getting started guide](./getting-started.mdx#2-create-a-config-file).

### How do I find the logs for `cross-seed`?

The logs for `cross-seed` are located in the `logs` directory of the config
directory described above. When troubleshooting, the `verbose.current.log` will
usually be the most helpful.

### What is `config.db`, `torrent_cache`, and `cross-seeds` in the config directory?

`config.db` is the SQLite database used by `cross-seed` to store information
about everything it does. `torrent_cache` is a directory that stores .torrent
files that `cross-seed` has snatched to prevent re-snatching them. `cross-seeds`
is the default [`ouputDir`](./options.md#outputdir) for `cross-seed`.

:::danger

Do not modify `config.db` or `torrent_cache` unless you know what you are doing.
Any modifications to these files should be handled through the `cross-seed`
commands on the [`commands page`](../reference/utils.md).

:::

### What should I do after updating my config?

Just restart `cross-seed`.

If you've changed your eligibility filters or your
[`matchMode`](options.md#matchmode) (e.g. enabling partial matches),
`cross-seed` will **automatically** re-evaluate previous cached rejections.

:::caution

It will **never** be necessary to delete your database or `torrent_cache` folder
to perform a "fresh search". Doing so only puts undue stress on indexers.

:::

### Does cross-seed support music torrents?

While `cross-seed` may incidentally find _some_ music matches, it is not
optimized for music _at all_. You will find better results with tools designed
for music cross-seeding like
[fertilizer](https://github.com/moleculekayak/fertilizer).

:::tip

Look to your music trackers' wikis and forums for more resources on
cross-seeding music.

:::

### How do I safely delete torrents from my client?

To safely delete a torrent from your client, either an injected cross seed or
the original torrent, you will need to meet these requirements:

- You have [`linking`](../tutorials/linking.md) configured
- You are using [`hardlinks or reflinks`](./options.md#linktype)
- You are using [`flatLinking: false`](./options.md#flatlinking)

If you meet these requirements, you can safely delete any torrent from client
along with the data. If you do not meet these requirements, you will need to
manually confirm that _absolutely_ no torrents are sharing the same data.

If you are using `linkType: "symlink"`, you cannot delete the original torrent
without breaking the links for the injected cross seeds. Deleting any injected
cross seeds is fine though.

You can always safely remove the torrent while keeping its data, but you will
need a method to clean up the orphaned data if it exists.

`cross-seed` does not manage ratio, delete torrents for cleanup, or decide when
tracker rules let you remove data.

### My database (`cross-seed.db`) has become HUGE!

#### Locating the cross-seed.db

cross-seed stores all of its data and records (history) inside the
`cross-seed.db` file located in your `/config` mount (Docker) or wherever your
config.js file is located (for non-Docker this is usually in the `.config` or
`.cross-seed` directory in your `$HOME` (Linux) or `%APPDATA%` (Windows); this
would be the same place as config.js (v6.x).

**Before anything is done, if possible (space permitting) make a backup of your
`cross-seed.db` file.**

#### What is wrong?

Sometimes, bad shutdowns/crashes, as well as race conditions if you run more
than one instance of cross-seed at a time (running a search or inject operation
from the command line while the daemon is running), can balloon the `.db` file
with freelist pages.

**You should not run two instances of cross-seed with the same config directory.
You can set an alternate config directory with copies of the same items in it
using the environmental variable `$CONFIG_DIR`**

#### What is the problem?

If you are running v6, Linux has a `sqlite` package. For Windows, you can get
the SQLite DB Browser at https://sqlitebrowser.org/dl/ (other methods of
managing the database are fine as long as you have access to SQL commands when
interfacing with the database, such as SQLiteBrowser from LinuxServer located at
https://docs.linuxserver.io/images/docker-sqlitebrowser/)

For the pre-release of v7, you can check your "Health" section to identify what
parts of your .db file have the extra disk space used, often this would be the
freelist pages, and if that is the source of the size then we are in luck, as it
is an easy fix.

#### What do I do?

1. First stop cross-seed and any instance of the daemon you may have running in
   the background.

2. For Linux users, or if you are running this on a seedbox, you will need SSH
   access and a binary called `sqlite3` - if you do not have this, you should
   ask your administrator to install the `sqlite3` package using any package
   manager. (If you are on Windows, or have the `database file` locally and are
   running Windows, you can use SQLite DB Browser from the link above to open
   the `cross-seed.db` file.)

3. Open the SQLite database using `sqlite3 cross-seed.db` or by selecting it and
   dragging it into the SQLite DB Browser (If using the DB Browser, you will
   need to go to the `Execute SQL` tab once the database is open)

4. Run the following command to see how many freelist pages you have

```sql
PRAGMA freelist_count;
```

5. If this returns a value above 0, then there are freelist pages that can be
   cleaned. Use the following command to clean all freelist pages and reduce the
   database size.

```sql
VACUUM;
```

6. Close the database file in DB Browser or use the `exit` command in the
   sqlite3 command line.

#### Sharing with us

Please report back the results of this. If this has not fixed your database's
size issue, we will likely want to perform some diagnostics.

### Is cross-seed a torrent management tool?

No. `cross-seed` finds cross-seed matches, links data when configured, and
injects matching torrents into your client.

It does not:

- Delete torrents for ratio management.
- Decide when it is safe to reclaim media-folder space.
- Replace qbit_manage, qBit Manage, or other cleanup tools.
- Manage tracker rules for minimum seed time or ratio.
- Clean orphaned linked data after you delete torrents.

For safer deletion behavior, use
[`hardlinks or reflinks`](./options.md#linktype) with
[`flatLinking: false`](./options.md#flatlinking), then verify cleanup in your
torrent-management tool.

### Is there a way to trigger a specific cross-seed job ahead of schedule?

You can use the `/api/job` API endpoint to trigger a job ahead of schedule. This
API can be triggered using a simple curl command, similar to how you would
manually send a webhook from your client.

You can find the details and usage for this API in the
[reference section](../reference/api.md#post-apijob).

Be aware that while this will trigger the schedule to be executed ahead of its
normal time, there are certain limitations and precautions you will want to
take. Do not abuse trackers or their respective APIs. Your accounts are
ultimately your responsibility, and you should make sure you review and respect
the rules of your trackers before you utilize any of their APIs directly.

### What's the best way to add new trackers?

:::tip

[**What should I do after updating my config?**](#what-should-i-do-after-updating-my-config)

:::

Just add the [`torznab`](./options.md#torznab) url to your config. `cross-seed`
will automatically queue searches for your catalog on just the new indexer(s).
If you want to trigger a search early, you can use the job API endpoint
described in the
[`FAQ entry`](#is-there-a-way-to-trigger-a-specific-cross-seed-job-ahead-of-schedule)
above.

:::danger

Do not run [`cross-seed search`](../reference/utils.md#cross-seed-search) while
the [`daemon`](./managing-the-daemon.mdx) is running as it will cause errors in
the sqlite database. Use the job API endpoint as shown below instead.

:::

For NPM or local installations, use the following command with the appropriate
API key:

```shell
curl -XPOST http://localhost:2468/api/job?apikey=YOUR_API_KEY -d 'name=search'
```

For Docker, use the following command with the appropriate API key:

```shell
docker exec -it cross-seed curl -XPOST http://localhost:2468/api/job?apikey=YOUR_API_KEY -d 'name=search'
```

### How can I disable the time-based exclude options in a `cross-seed search`?

:::tip

If you are simply adding a new tracker, follow this
[FAQ entry](#whats-the-best-way-to-add-new-trackers) instead.

:::

In order to disable and override the [`excludeOlder`](./options.md#excludeolder)
and [`excludeRecentSearch`](./options.md#excluderecentsearch) options defined in
your `config.js`, you can use the job API endpoint described in the
[`FAQ entry`](#is-there-a-way-to-trigger-a-specific-cross-seed-job-ahead-of-schedule)
above. This will, for the duration of the search being run, disable the options
completely - searching for absolutely everything available.

:::danger

Do not run [`cross-seed search`](../reference/utils.md#cross-seed-search) while
the [`daemon`](./managing-the-daemon.mdx) is running as it will cause errors in
the sqlite database. Use the job API endpoint as shown below instead.

:::

For NPM or local installations, use the following command with the appropriate
API key:

```shell
curl -XPOST http://localhost:2468/api/job?apikey=YOUR_API_KEY \
  -d 'name=search' \
  -d 'ignoreExcludeRecentSearch=true' \
  -d 'ignoreExcludeOlder=true'
```

For Docker, use the following command with the appropriate API key:

```shell
docker exec -it cross-seed curl -XPOST http://localhost:2468/api/job?apikey=YOUR_API_KEY \
  -d 'name=search' \
  -d 'ignoreExcludeRecentSearch=true' \
  -d 'ignoreExcludeOlder=true'
```

### What causes `outputDir should only contain .torrent files` warning?

:::tip

Use [`outputDir: null`](./options.md#outputdir) to prevent any issues from
occurring.

:::

Typically this error occurs when [`outputDir`](./options.md#outputdir) is set to
a directory which is already in use or is not empty. `outputDir` is a sort of
"working directory" for cross-seed, and needs to be set to a dedicated empty
directory. `outputDir` is used as a temporary store for tracking things like
failed injections (for retrying later) and .torrent files which are being
monitored for resuming after a recheck. Do not put anything in this directory if
you do not intend to have it be matched to your data and injected, and do not
delete anything in this directory unless you do not want to cross-seed that
torrent.

:::tip Repeated Injections

It is possible that you find you want to remove a torrent file that was
cross-seeded from your client that was injected, and find it reappearing shortly
after removal. This could be because of the inject job and the corresponding
.torrent file in `outputDir`.

To stop the reinjection, simply remove this .torrent file from `outputDir` and
then delete the torrent from your client.

:::

### What is "Could not ensure all torrents from the torrent client are in `torrentDir`"?

:::tip

Use [`useClientTorrents: true`](./options.md#useclienttorrents) instead of
[`torrentDir`](./options.md#torrentdir).

:::

This is usually due to not using the recommended paths for
[`torrentDir`](./options.md#torrentdir). You should use your torrent client's
directory (that stores .torrents and fastresume states). This is not a "Copy of
.torrent" folder, but a folder you would find inside of the config or appdata
folders for the torrent client specifically.

Using another directory (such as "Copy of" directories) with injection can lead
to outdated or latent .torrent files being left behind, and when this happens
cross-seed is unaware that they are not actually in the client seeding.

If you are using the appropiate directory and still see this, it means you need
to go clean up (verify the torrent files listed) are in your client, and remove
those that aren't.

You can find a list of example paths for reference in the options page under
[`torrentDir`](./options.md#torrentdir)

:::warning qBittorrent

qBittorrent users utilizing injection are required to use BT_backup for their
`torrentDir` when using injection.

:::

### Why are some torrents not suitable for searching?

Seeing a difference in total torrent count and suitable torrents (as well as
unique searches) is expected behavior. This is usually due to `config.js`
settings such as `includeSingleEpisodes` or `includeNonVideos`, exclude options
based on age or last search date, or duplicate search queries which have been
reduced to a single query.

:::tip

You can review the verbose logs for `[prefilter]` entries at the start of a
search for details on what torrents will be excluded and why.

:::

### What can I do about `error parsing torrent at http://…`?

This means that the Prowlarr/Jackett download link didn't resolve to a torrent
file. You may have been rate-limited, so you might want to try again later.
Otherwise, just ignore it. There's nothing `cross-seed` will be able to do to
fix it.

### Does cross-seed work on public trackers?

Don't add public trackers to your cross-seed config (i.e. as a
[torznab URL](options.md#torznab)).

Public torrents will usually have the same infoHash across multiple trackers,
which is not the case on private trackers. Because of this, `cross-seed` does
not consider these torrents matches since it looks like you already have them.

In theory, we could add the announce urls to the torrent already in your client,
but public torrents make heavy use of
[DHT](https://en.wikipedia.org/wiki/Distributed_hash_table) and
[PEX](https://en.wikipedia.org/wiki/Peer_exchange), which are decentralized
mechanisms for finding peers to seed to. Therefore, the role of a tracker in a
public torrent is somewhat redundant and new trackers usually won't give you new
peers.

It is however fine to **download something from a public tracker and then
cross-seed it to private trackers**, which `cross-seed` supports automatically.

### Can I use special characters in my URLs?

To use special characters (`!@#$%^&*`) in your URLs for user/passwords, you will
have to use URL encoding for ONLY the portion of the URL containing the special
characters.

For instance, if your user or password contains a special character `#`, you
will need to go to [URLEncoder.org](https://www.urlencoder.org/) and encode
**THIS PORTION OF YOUR URL ONLY**!

Replace the original user or password with the encoded one in your config file.

### Why do I get `Unsupported: magnet link detected at…`?

`cross-seed` does not support magnet links. If your indexer supports torrent
files you will need to switch your settings.

### rTorrent injected torrents don't check/start at all until force re-checked

Remove any `stop_untied=` schedules from your .rtorrent.rc.

Commonly:
`schedule2 = untied_directory, 5, 5, (cat,"stop_untied=",(cfg.watch),"*.torrent")`

### `SyntaxError: Unexpected identifier` when I try and start cross-seed

`cross-seed` configuration files are formatted with a comma at the end of each
identifier (option). If you are seeing this error it is most likely that you are
missing a comma at the end of the setting BEFORE the identifier specified in the
error.

Alternatively, you could also be missing quotes around the value you provided.
Check the syntax before and around the config setting given in the error.

### `RangeError: WebAssembly.instantiate(): Out of memory` error when starting

If you receive this error when trying to start `cross-seed`, usually presenting
in shared seedbox environments, it is likely caused by a limitation in the
virtual memory able to be allocated to your instance of `cross-seed`.

To fix this error, it is necessary to use at least Node v20.15 and set the
`NODE_OPTIONS` environment variable to include the
[`--disable-wasm-trap-handler`.](https://nodejs.org/en/blog/release/v20.15.0#cli-allow-running-wasm-in-limited-vmem-with---disable-wasm-trap-handler)
flag.

To ensure a successful startup of cross-seed, you can simply execute cross-seed
with the following command.

```shell
NODE_OPTIONS=--disable-wasm-trap-handler cross-seed daemon
```

### Why won't cross-seed start with `val is not a non-empty string`?

This is due to a corrupted database, and is often ran into during a
initialization of a new or migrated instance.

For a brand new instance of cross-seed wipe the `cross-seed.db` file from your
configuration directory, and if an old instance the contents of
`./torrent_cache` as well.

Simply restart cross-seed, and you should be good to go. If not, please contact
us on Discord with logs.

### Failed to inject, saving instead.

The best way to start troubleshooting this is to check the `logs/verbose.*.log`
and find this specific event.

For some torrent clients, this error can occur if there are no torrents loaded.
Try adding at least one torrent file to the client, and then retry injecting.

You will be able to see the circumstances around the failure and start
investigating why this occurred.

### My data-based search is searching torrent files!

Torrents from your client take precedence over data files. If possible,
`cross-seed` will always attempt to create links for data and torrents being
injected into a client, so the end result will generally be the same.

If you wish to search only for data files, you can set
[`useClientTorrents`](./options.md#useclienttorrents) to false and
[**`torrentDir`**](options.md#torrentdir) to `null`, but we generally don't
recommend it as torrent-based matching is more efficient than data-based
matching.

### Error: ENOENT: no such file or directory

This is usually caused by broken symlinks in, or files being moved or deleted
from, your [`dataDirs`](./options.md#datadirs) during a data-based search. Check
the `/logs/verbose.*.log` files for the file causing this.

:::caution

If you do not link files within your `dataDirs` or have them outside of the
[`maxDataDepth`](../tutorials/data-based-matching.md#setting-up-data-based-matching)
visibility, this is preventable.

:::

### My torrents are injected (qBittorrent) but show `missing files` error!

If you see injected torrents show up with a `missing files` error, it is likely
due to incorrect paths/mounts/volumes or permissions (`cross-seed` must have the
same [user and group](./getting-started.mdx#docker-installation) as your torrent
clients). The logs from qBittorrent will usually state the specific reason.

For Docker examples and commands to verify the paths inside the container, see
[Docker paths and mounts](./common-setup-failures.md#docker-paths-and-mounts).

### I'm getting errors in cross-seed on hostingby.design seedbox

:::info

Although we are providing the information given from hostingby.design, we are
not able to support this directly. This is just what was passed to us. Contact
them for details and further instructions if you have any issues

:::

1. Get your shared instance IP address (`cat ~/.install/subnet.lock`)
2. Torznab URLs should be: `http://ip:port/prowlarr/[id]/api?apikey=[apikey]`
3. Your torrent client should be on the same subnet (if installed after dec.
   2023). If not, update the “bind ip” address in web ui settings to your ip
   from step 1 and restart the torrent client
4. The torrent client address URL in `cross-seed` config should be
   `http://user:pass@ip:port` (note: no `/qbittorrent` or `/deluge` etc at the
   end)

:::caution

The subnet/shared instances are reverse proxies so no https

:::

### I can't reach my Prowlarr/Jackett/cross-seed/torrent client (Using Docker/VPN)

:::danger

Even with API authentication, we still recommend that you **do not expose
`cross-seed`'s port to untrusted networks (such as the Internet).**

:::

If you are using [Docker](./getting-started#docker-installation), you cannot use
`localhost` as an address to communicate across containers. Consider using your
host's local IP address (usually a 192 or 10 address) or the container name (if
using a "Custom Docker Network").

If your setup is running with a VPN, you will need to either

1. Set up split tunneling
2. Try to use the Docker network addresses as your instance hostnames
3. Address the routing of local/internal traffic in your VPN configuration

Generally, you won't be able to access local instances from services utilizing a
VPN since localhost/LAN is not accessible from the VPN network by default.

:::info

There is no need to put `cross-seed` behind a VPN. All `cross-seed` requests are
made to your torrent client or Jackett/Prowlarr. The only exception is when
announcements are made via the `/announce` API endpoint and are snatched during
matching or for injection.

:::

For webhook-specific examples, `/api/ping` tests, and common `curl` errors, see
[Docker networking and webhooks](./common-setup-failures.md#docker-networking-and-webhooks).

### Searching media libraries vs. torrent data (data-based searching)

You can search both your media libraries (Arr/Plex) and actual torrent data
(downloaded files) using [`dataDirs`](./options.md#datadirs). If you are using
the media libraries with renamed files, you will need to use
[`matchMode: "flexible"`](./options.md#matchmode) or
[`matchMode: "partial"`](./options.md#matchmode) in your configuration file to
allow leeway in the matching process.

### Why do I see `it has a different file tree` in my logs?

This is a result of the matching algorithm used by `cross-seed`, and is most
commonly associated with only a few scenarios. These include the presence of
additional .nfo/.srt files in a torrent, differences in the organization of
files (one torrent having a folder while the potential match does not, or vice
versa), and discrepancies in the filenames within the torrent. Setting up
[Partial Matching](../tutorials/partial-matching.md) will ignore these
extraneous small files during matching, and improve your match rate at the cost
of redownloading some of these small files.

:::tip

You can use the [`cross-seed diff`](../reference/utils#cross-seed-diff) command
to compare two torrent files and see exactly how they differ.

:::

### How can I use [**autobrr**](https://autobrr.com/) with cross-seed?

Instructions for using `autobrr` with `cross-seed` can be found in the
[`Announce Matching Tutorial`](../tutorials/announce.md).

### My tracker is mad at me for snatching too many .torrent files!

In order to prevent false positives, `cross-seed` snatches some .torrent files
that may not ultimately match your owned torrents. It preserves every torrent
file that it snatches.

We have spoken to admins at several trackers and have settled on a set of
default settings that these trackers prefer. As of v6, this should no longer be
a concern unless you are using commands such as
[`cross-seed clear-cache`](../reference/utils.md#cross-seed-clear-cache) or
[`cross-seed clear-indexer-failures`](../reference/utils.md#cross-seed-clear-indexer-failures).
If your tracker has reached out to you about your usage of cross-seed, consider
reducing your [`searchLimit`](./options.md#searchlimit) and using higher values
for [`excludeRecentSearch`](./options.md#excluderecentsearch) and
[`excludeOlder`](./options.md#excludeolder).

:::caution

Your tracker may have opinions on `cross-seed`'s behavior regarding snatches,
and it is important to respect these or risk your account being disabled.

:::

`cross-seed` reduces unnecessary snatches of .torrent files as much as possible,
but because it needs to compare the files inside the torrent as well as their
sizes, it is sometimes unavoidable. To improve matching efficiency, **consider
setting up [ID-based searching](../tutorials/id-searching.md)**, which searches
based on IMDb IDs and often results in less strain on trackers, more specific
search results, and less unnecessary snatches.

### My partial matches from related searches are missing the same data, how can I only download it once?

`cross-seed` is not aware of what matches will happen ahead of time, each is
performed with zero knowledge of the previous or the following. As such, it is
possible to have situations where a partial match when complete would become a
perfect match for another otherwise partial match. This is usually neglibile
since the missing data is small, but in cases where it is significant such as
with [seasonFromEpisodes](./options.md#seasonfromepisodes), you can use the
[inject](../reference/utils.md#cross-seed-inject) feature.

If you have not recently deleted files in your
[outputDir](./options.md#outputdir), then these torrents will still have their
.torrent file present. If so, simply pick one torrent to complete the download
on and that's it! `cross-seed` uses all possible matches to source files with
the inject job or when using `cross-seed inject`. It will detect the newly
downloaded files, link them to the other torrents, and trigger a recheck for
those torrents.

:::tip

If you have configured
[webhook on completion](../tutorials/triggering-searches.md), once the selected
torrent is completed, `cross-seed` will automatically trigger an early run of
the inject job.

:::

For the rare case that the .torrent files are not present in `outputDir`. First,
choose which tracker you'd like to complete the download on and start the
torrent. Then copy (or export) the .torrent files from the other related partial
matches to a safe place. Once the download is complete, follow the steps
[here](../tutorials/injection.md#manual-or-scheduled-injection) to re-inject the
copied and renamed .torrent files. `cross-seed` will automatically use the newly
completed torrent over the previous (or ensemble) that caused the partial match.

:::danger

Manual injections such as what is performed here requires the renaming of
.torrent files for proper linking.

[**Read More**](../tutorials/injection.md#manual-or-scheduled-injection)

:::

### How can I force inject a cross seed if its source is incomplete?

In most scenarios, `cross-seed` will not inject matches if the source is
incomplete. The only time `cross-seed` will, is from the `cross-seed inject`
command or from the inject job. If the age of the saved .torrent file
(determined my last modified time) is older than a day, `cross-seed` will inject
and link files even from an incomplete source if
[`linkDirs`](./options.md#linkdirs) and [`partial`](./options.md#matchmode) is
enabled. These injections will always be treated as `partial` matches which are
paused and rechecked.

Once the torrent has finished rechecking, it's progress may be anywhere from 0%
to 100%. You will then have to choose between resuming the torrent or removing
it from client with the corresponding .torrent file in
[`outputDir`](./options.md#outputdir). Of course this is no longer "cross
seeding", but it does allow the possibility of reviving the stalled torrent used
as the source. In order to do this, you may need to follow the manual steps
outlined in the
[faq entry](#my-partial-matches-from-related-searches-are-missing-the-same-data-how-can-i-only-download-it-once)
above on the stalled torrent.

:::caution

This is not true "cross seeding" and will likely incur significant download for
the matched torrent. This should rarely be needed as `cross-seed` can match from
multiple sources. `cross-seed` is simply offering you the ability to revive the
stalled torrents inside your client.

:::
