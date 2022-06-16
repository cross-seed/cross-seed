**A basic install guide for Unraid.** To install in Unraid the easiest set up
will be to use the Community Applications App found
[here](https://forums.unraid.net/topic/38582-plug-in-community-applications/).
Once the app is installed go to the app tab and search cross-seed, hit enter and
you should get no results then hit the Click Here To Get More Results From
DockerHub link.

That should populate the search page with the existing docker hub images. For
the sake of support use the mmgoodnow/cross-seed image. Hit install and once
downloaded you should be presented with the familiar unraid docker page.

Hit the advanced options switch in the top right.

In the Post Arguments: section add daemon.

Set privileged to on

Click Add another Path, Port, Variable, Label or Device and add Config Type:
Path, Name: Config, Container Path: /config, Host
Path:/mnt/user/appdata/cross-seed/, Access Mode: Read / Write

Click Add another Path, Port, Variable, Label or Device and add Config Type:
Path, Name: input, Container Path: /torrents, Host Path:/mnt/user/appdata/"PATH
TO YOUR TORRENT FILES", Access Mode: Read Only

Click Add another Path, Port, Variable, Label or Device and add Config Type:
Path, Name: output, Container Path: /output, Host Path:/mnt/user/appdata/"PATH
TO YOUR TORRENT CLIENTS MONITORED FOLDER"

Click Add another Path, Port, Variable, Label or Device and add Config Type:
Port, Name: port, Container Port: 2468, Host Port: 2468, Connection Type: TCP

Attached screenshot of what it should now look like. That should be that. You
will still need to create a config by starting the docker and editing it further
as per the wiki.

![screenshot-cross-seed](https://user-images.githubusercontent.com/2813049/147599328-6032688e-45e4-43cf-87f6-a070829e1a1b.png)
