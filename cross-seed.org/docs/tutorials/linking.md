---
id: linking
title: Linking
sidebar_position: 2
---

With [`matchMode: "strict"`](../basics/options.md#matchmode), `cross-seed` will
only look for "perfect" matches—candidate file trees that have the exact same
file tree, or a strict subset of the file tree, of the data you already have.
Then it injects the torrents into your client by mirroring the save path of the
torrent you already had.

### What is linking?

When a torrent has the same data as another torrent but a different name, you
could theoretically seed both torrents by copying the file and renaming it, but
this isn't practical—you have to store the data twice even though it's
identical. Linking is an alternative to copying that lets two file names point
to the same underlying data on disk. There are three types of links: _symlinks_,
_hardlinks_, and _reflinks_. `cross-seed` uses **hardlinks** by default.

### Should I set up linking?

You don't need to set up linking with
[`matchMode: "strict"`](../basics/options.md#matchmode). However, you will need
to set up linking in order to enable the more complete matching strategies such
as [partial matching](partial-matching.md) or if you want to use
[data-based matching](data-based-matching.md). When linking is enabled, **all**
injected torrents will be linked, even perfect matches. With hardlinks or
reflinks, a match whose data sits on a drive with no linkDir (for example a
network share) fails, unless
[`injectInPlaceWithoutLinkDir`](../basics/options.md#injectinplacewithoutlinkdir)
lets perfect matches be injected in place, without a link.

If you have multiple clients and/or dataDirs configured, `cross-seed` will link
matches into the first valid linkDir. Custom routing is not supported at this
time.

:::info

In order to prevent collisions, `cross-seed` organizes linked torrents into
subfolders of your [`linkDirs`](../basics/options.md#linkdirs) based on the
tracker each torrent came from. If you wish to disable this behavior, you can
set the [`flatLinking`](../basics/options.md#flatlinking) option to `true`, but
it is not recommended for new users.

:::

## Setting up linking

::::danger

**`cross-seed` AND YOUR TORRENT CLIENT MUST BE ON THE _SAME_ OS TO USE LINKING**
**(DOCKER ALWAYS RUNS ON LINUX, EVEN ON WINDOWS)**

[**For Windows users, it is necessary to insert double-slashes for your paths, back-slashes are "escape characters" and "\\\\" equates to "\\".**](../basics/faq-troubleshooting.md#windows-paths)

:::tip

If you cannot use linking, you may want to use
[`duplicateCategories: true`](../basics/options.md#duplicatecategories) if you
are using sonarr or radarr.

:::

::::

To set up linking, you need to define at least one directory where `cross-seed`
will create links to your existing files and set the
[`linkDirs`](../basics/options.md#linkdirs) option to these directories in your
config file. These directories should be accessible to your torrent
client—`cross-seed` will use the `linkDir` on the same device as the save path
for the torrents it injects.

If you are utilizing [`hardlinks`](#hardlink) or [`reflinks`](#reflink) with
Docker, it is necessary that you to use a single mount/volume for each of the
`linkDirs` and the data in your client and/or `dataDirs` from which you're
linking . Using `hardlinks` across two volumes/mounts in Docker will error and
fail.

All paths need to be accessible in the same structure as your torrent client for
injection to succeed.

:::tip

If your injected torrents show `0%`, `missing files`, or logs such as
`Linking failed ... not found`, work through
[Common Setup Failures](../basics/common-setup-failures.md#docker-paths-and-mounts)
before changing matching settings.

:::

### Configuring [`linkDirs`](../basics/options.md#linkdirs)

:::tip

[**What should I do after updating my config?**](../basics/faq-troubleshooting.md#what-should-i-do-after-updating-my-config)

Ideally, you should only have a single linkDir and use drive pooling. Using
multiple linkDirs should be reserved for setups with cache/temp drives or where
drive pooling is impossible.

:::

In nearly all cases, your linkDirs should reside in your torrent client download
directory. In the example below, your torrent client download directory would be
`/mnt/user/data/torrents/`.

```
mnt/
├─ user/
│  ├─ data/
│  |  ├─ usenet/
│  |  |  ├─ movies/
│  |  ├─ torrents/
│  |  |  ├─ tv/
│  |  ├─ radarr/
│  |  |  ├─ Movie/
│  |  ├─ sonarr/
│  |  |  ├─ Show/
```

Your `linkDirs` would then be:

```js
module.exports = {
	// ... other settings ...
	linkDirs: ["/mnt/user/data/torrents/SomeLinkDirName"],
};
```

If you have multiple drives without drive pooling, add more linkDirs as needed
for each drive. Once you have restarted `cross-seed`, new matches will have
links created in your `linkDirs` pointing to the original files.

:::info Docker Users

**For Docker Users**: there are a few more specific requirements for linking to
work properly.

- Your torrent client will need access to the `linkDirs` you've set, seeing the
  same path `cross-seed` sees.
- `cross-seed`'s container needs to be able to see the **original data files**,
  again at the same path that your torrent client sees.
- If you are using **hardlinks** or **reflinks**, these paths all need to be
  _within the same docker volume_.

In practice, this means that you should mount a **common ancestor path** of the
both the original data files _and_ your `linkDirs`. The example above would
require a single mount of `/mnt/user/data:/data` for **BOTH** cross-seed and
your torrent client. Your `linkDir` would then be:

```js
module.exports = {
	// ... other settings ...
	linkDirs: ["/data/torrents/SomeLinkDirName"],
};
```

[**See the Docker path examples and diagnostics.**](../basics/common-setup-failures.md#docker-paths-and-mounts)

:::

## Hardlinks vs Symlinks vs Reflinks

By default, `cross-seed` uses hardlinks to link files because they are resilient
to file moves. You can switch the link type by setting the
[`linkType`](../basics/options.md#linktype) option.

### Hardlink

A hardlink is a **direct line** to the actual data on disk, and as far as the OS
is concerned, is indistinguishable from the original file. Because of this,
hardlinks are resilient to being moved, and if you delete the original file, any
other links to the data will remain intact. The underlying data is deleted once
there are zero files left that point to it.

Because hardlinks are implemented at the filesystem layer, they only work within
the same mountpoint, so you can't hardlink a file from an internal drive to an
external drive. This is especially relevant in Docker setups - Docker volumes
are isolated from each other, so **hardlink sources and destinations must always
be within the same Docker volume**, or else linking will fail.

#### When to use hardlinks

- Your setup moves files around and you don't want to break links
- You want to keep cross-seeding torrents even after deleting originals
    - Look into [**qbit_manage**](https://github.com/StuffAnThings/qbit_manage)
      to still be able to delete hardlinked files when originals are deleted

### Reflink

A reflink works similarly to hardlinks until data is written to it. Instead of
modifying both files, only the new data is overwritten on the targeted file.
This means a reflink with a file starts out identical but can diverge over time
if either is modified. This has the same restrictions as
[`hardlink`](#hardlink).

::::tip

There are two types of reflinks available to use in `cross-seed`.
`linkType: "reflink"` will error if the filesystem does not support it.
`linkType: "reflinkOrCopy"` will fallback to copying if reflinks are not
supported.

:::danger

Under no circumstances should you allow `cross-seed` to copy data.
`linkType: "reflinkOrCopy"` should ONLY be used in extremely limited
circumstances and will require _YOUR_ testing to confirm there are no copies.

[**The original use case for `reflinkOrCopy` is detailed here**](https://github.com/cross-seed/cross-seed/issues/1031#issuecomment-3217435128)

:::

::::

#### When to use reflinks

- Your filesystem supports it
- You want to cross seed the rare files that differ between trackers. Any
  differences between these two files will not affect the other while still
  sharing the indentical parts.

### Symlink

A symlink is a **shortcut** that stores a path to the original file. OSes have
special support for symlinks that allow programs (like torrent clients) to treat
them as regular files. Because a symlink itself only contains a file path, if
you move or delete the original file, the link will break and trying to open it
will throw an `ENOENT: no such file or directory` error.

#### When to use symlinks

- Your setup doesn't move files around
- You want to stop cross-seeding torrents when originals are deleted, but don't
  use [**qbit_manage**](https://github.com/StuffAnThings/qbit_manage)
    - This will present as cross-seeded torrents with missing files errors in
      your torrent client which you can then bulk delete
- You prefer errors over accidentally silently copying data
