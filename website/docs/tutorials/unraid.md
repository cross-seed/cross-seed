---
id: unraid
title: Unraid
---

## Installation

To install in Unraid, the easiest setup will be to use the
[Community Applications](https://forums.unraid.net/topic/38582-plug-in-community-applications/)
app. Once the app is installed, go to the **App** tab and search for
`cross-seed`. After you get no results, click on the **Click Here To Get More
Results From DockerHub** link. From there you should be able to install the
`mmgoodnow/cross-seed` image from the list.

## Configuration

Hit the **Advanced options** switch in the top right.

In the **Post Arguments** section, add `daemon`.

Set **Privileged** to `on`.

### Port Mappings

Cross-seed can listen for HTTP requests for when a torrent finishes downloading
or you receive an announce.

:::tip

If you don't need to use these features **from outside of Docker**, then you can
skip this step.

:::

Click on **Add another Path, Port, Variable, Label or Device** and set the
following attributes:

| Config Type | Name | Container Port | Host Port | Connection Type |
| ----------- | ---- | -------------- | --------- | --------------- |
| Port        | Port | 2468           | 2468      | TCP             |

### Volume Mappings

Cross-seed needs to access 3 directories: an input directory with torrent files,
an output directory for cross-seed to save new torrent files, and a config
directory. For each of these directories, click on **Add another Path, Port,
Variable, Label or Device** and fill out the form following the table below.

| Config Type | Name   | Container Path | Host Path                           | Access Mode |
| ----------- | ------ | -------------- | ----------------------------------- | ----------- |
| Path        | Config | /config        | /path/to/your/cross-seed/config/dir | Read/Write  |
| Path        | Input  | /torrents      | /path/to/torrent/client/session/dir | Read Only   |
| Path        | Output | /output        | /path/to/torrent/client/watch/dir   | Read/Write  |

## Screenshot

Below is a screenshot of what your docker container configuration might look
like. Now, you can try starting the docker container and editing the resulting
configuration file in the next step.

![screenshot-cross-seed](https://user-images.githubusercontent.com/2813049/147599328-6032688e-45e4-43cf-87f6-a070829e1a1b.png)
