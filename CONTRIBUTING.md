# Writing code

1. Download VS Code. it has typescript support out of the box, but any ide will
   do. recommend downloading a typescript plugin if needed
2. clone repo
3. open repo in vs code
4. run npm install
5. start coding :)

the code is in `/packages/cross-seed/src`. `cmd.js` is the entrypoint,
`pipeline.js` is the interesting high level functions (doRss, etc...)

# Build and Run

`npm run build` will compile the typescript files into javascript files in
`/packages/cross-seed/dist` `npm run watch` will compile, then incrementally
compile when files change the `cross-seed` command is an alias for
`node packages/cross-seed/dist/cmd.js`, as in
`node packages/cross-seed/dist/cmd.js daemon` but it's annoying to use the
cross-seed alias while developing so i use a lot of ctrl-R with fzf

# Testing

I keep a `config.js` that points to
`{ torrentDir: "./input", outputDir: "./output" }` and put some torrent files in
`./input` I usually run in search mode because it's the simplest form of
cross-seed and most work applies to it.

## testing daemon mode

have three terminals open, one for npm run watch, one for keeping the cross-seed
daemon open, and one for curling to localhost:2468

## testing direct injection

mostly i stick with `--save` (the default i think) usually i use docker to run
whichever client. you could install it yourself though I have a gitignored
docker_compose.yml that keeps track of all of the clients but i only run them
one at a time

# Releasing

```
git checkout master
git pull
npx np
```

If there's a new typescript file, it'll tell you it won't be included. That's
correct - the typescript files in `packages/cross-seed/src` aren't included, but
they compile down to javascript files in `packages/cross-seed/dist` which _are_
included.

It'll ask you if you want to increment patch, minor, or major version. I think
I'd say _don't bump major_ unless we've talked about it in `#development`. Minor
vs patch is kind of meaningless but mostly patch for fixes and minor for
features.

For pre-releases, you first select the `prepatch/preminor/premajor` option the
first time, then for subsequent pre-releases you use the `prerelease` option to
increment.

Then it'll do a bunch of compiling, etc. Eventually it will open a tab in your
browser asking you to create a release. Then you can just click the Submit
button and you're done.

If a non-pre-release version has been published, update the @next tag to point
to latest as it's not done automatically.

```
npm dist-tag add cross-seed@x.x.x next
```

If you ever fuck up (often due to forgetting the github release), just release
again with a `patch` version bump. no big deal
