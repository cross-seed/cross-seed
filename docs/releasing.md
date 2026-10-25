# Publishing npm releases

The `Publish npm release` workflow is a deliberately dispatched **v7+** npm
publication step. It does not create commits, tags, GitHub releases, or Docker
images. The `v6` branch keeps its legacy packaging/release process.

## One-time setup

After this workflow is merged, configure the `cross-seed` package's
[trusted publisher](https://docs.npmjs.com/trusted-publishers/) on npm:

- Provider: GitHub Actions.
- Organization: `cross-seed`; repository: `cross-seed`.
- Workflow filename: `npm-publish.yml` (filename only).
- Environment: `npm`, matching the workflow's publish job.
- Allow direct `npm publish`. Dist-tag management permission is unnecessary:
  this workflow chooses the tag on publication and never calls `npm dist-tag`.

Create the GitHub `npm` environment and allow deployments from the intended `v*`
release tags. Recommended: require a maintainer approval. Protect `v*` tags
against updates/deletion; the workflow checks the tag before packing and
immediately before publication, but server-side protection prevents changes
during that last check/publish interval.

There is no npm token secret and no local `npm whoami` or login prerequisite.
Only the publish job receives `id-token: write`, uses GitHub-hosted runners, and
runs without `npm ci` or lifecycle scripts. Node 26 supplies a sufficiently new
npm CLI (trusted publishing requires npm 11.5.1+ and Node 22.14+). Provenance is
requested. Build/test steps have read-only repository permissions and no OIDC.
The initial trust/environment setup and a live OIDC publish still need a
maintainer to perform them; local tests cannot prove npm trusts the workflow.

## Release procedure

1. Review and merge the release changes, including this workflow for its first
   use. Update `cross-seed/package.json` and the workspace lockfile, validate,
   and commit the version using the normal review/push approval process.
2. Create and push the corresponding immutable `v<version>` tag on a commit
   reachable from `master`. This workflow accepts v7+ canonical versions, such
   as `v7.0.0-27` or `v7.0.0`, not branches or build-metadata aliases.
3. Dispatch **Publish npm release** at that exact tag in GitHub Actions,
   supplying the same tag as `release_tag`. For example:

    ```sh
    gh workflow run npm-publish.yml --ref v7.0.0-27 -f release_tag=v7.0.0-27
    ```

    The workflow must already exist on the default branch and on the selected
    tag. Do not dispatch from `master` and merely supply a tag input: npm
    provenance uses the workflow event ref/SHA, not just the checkout. The
    helper rejects that mismatch. This is an external publication; do not
    dispatch while work is intended to remain local.

4. Review/approve the `npm` environment deployment if configured. Check the
   final verified-release summary and logs, not just npm's upload message.
5. Complete the GitHub release notes and check Docker and standalone assets for
   the same tag/commit. Those are independent jobs and can fail independently.

The package job checks out the explicit tag, runs formatting, build, lint,
TypeScript checks, workspace tests, and release-helper tests. It packs once,
records the source SHA/version/channel/SHA-512 in `release.json`, installs that
exact tarball into an isolated prefix, and boots the installed daemon to verify
HTTP auth/validation, embedded UI, a base path, CLI discovery, and shutdown. The
artifact includes both that tested tarball and its manifest.

The publish job checks out the resolved SHA, downloads that same artifact,
checks its checksum/package metadata and the current local/remote tag, then
publishes the tarball with `--ignore-scripts`. It does not rebuild or repack.

### Channels

- A prerelease (for example `7.0.0-27`) uses **`next`** and verifies `latest`
  remains unchanged.
- A stable version (for example `7.0.0`) uses **`latest`**. It does not promote
  `next`; a later decision to make both channels equal is a separate explicit
  operation.
- The helper refuses to move the chosen channel backwards, including rerunning
  an older v7 release. v6 releases must not use this workflow or overwrite v7
  `latest` after v7 stable ships.

Publication workflows are serialized across tags and never cancel an ongoing
publish. External/manual publishers can still race; an unexpected channel change
fails verification instead of being silently corrected.

### Existing Docker and standalone workflows

Keep using `ci.yml` for Docker (tag push) and `sea.yml` for standalone binaries
(GitHub release publication). Do not duplicate those builds in the npm workflow.
A release created by `GITHUB_TOKEN` does **not** trigger another workflow
through its `release` event. Create the release as a maintainer, or explicitly
dispatch `sea.yml` on the same tag with its `release_tag` input; when
dispatching SEA, select the tag as the workflow ref as well as supplying the
input. The input alone names the destination release; it does not select the
source checkout. See
[GitHub's event-trigger rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow).

## Availability and reruns

npm's
[publish-time scanning](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)
can delay public availability. An accepted upload, HTTP 202, or a moved dist-tag
is not a completed release. The helper polls version availability with bounded
backoff for 30 minutes, verifies the intended channel, and downloads the public
tarball to compare SHA-512 with the tested artifact. HTTP 202/404 while pending
are retried; authentication, network, unexpected HTTP, and integrity errors fail
with a diagnostic. A failure can mean a partial release; inspect the logs.

If scanning takes longer, **do not increment the version or upload it again**.
Rerun the failed publish job, retaining the original build artifact. A visible
pending version is waited on; an existing matching version is verified without
another publish. A previously accepted upload can still return GET-404 during
scanning. In that case, a rerun may attempt the upload once: only an explicit
immutable- version conflict resumes verification of the reserved version.
Authentication and other publication failures still fail immediately. An
existing version with a different integrity fails closed. An existing version
with a different channel target fails and requires manual review; the helper
never silently retags an old version. If the original artifact has expired or
you rerun the entire build, the new tarball must match the already published
integrity or the workflow will refuse to skip it. Preserve the original artifact
if investigating a partial release.

## Local checks without publishing

```sh
node --test scripts/npm-release.test.js
npm run format:check
npm run build
npm run lint
npm run typecheck
npm test
```

The release tests inject a registry and a publication adapter: they never call
`npm publish` or modify the real registry. They exercise channel selection,
version/tag rejection, immutable bytes, stable-channel preservation, scan
pending responses, bounded retries, authentication/network failures, reruns, and
public checksum mismatch.

For a local packaging rehearsal at an existing matching release-tag checkout:

```sh
mkdir /tmp/cross-seed-release-rehearsal
(cd cross-seed && npm pack --workspaces=false --pack-destination /tmp/cross-seed-release-rehearsal)
mv /tmp/cross-seed-release-rehearsal/cross-seed-*.tgz /tmp/cross-seed-release-rehearsal/cross-seed.tgz
node scripts/npm-release.js prepare /tmp/cross-seed-release-rehearsal v7.0.0-26
```

`prepare` only validates and writes a local manifest; it does not publish. The
`publish` subcommand **does publish** unpublished versions and must only run
when explicitly releasing, with the intended trusted-publisher identity.
