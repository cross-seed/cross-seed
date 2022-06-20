---
id: config
title: Configuration File
---

`cross-seed` will look for a configuration file at `~/.cross-seed/config.js`
(`AppData\Local\cross-seed\config.js` on Windows). In the configuration file ,
you can specify all of the same flags you specified on the command line, but
after that, you won't have to specify them on the command line any more. If you
would like to use a different directory than the default, you can set the
`CONFIG_DIR` environment variable.

For details on the individual parameters, please read the
[configuration template](https://github.com/mmgoodnow/cross-seed/blob/master/src/config.template.cjs).

To create a configuration file, run

```shell script
cross-seed gen-config
```
