/**
 * qBittorrent 5.3.0 / Web API 2.16.0 replaced the boolean `skip_checking`
 * field with the boolean `seedMode` field on `torrents/add`. Older clients
 * still require the old field.
 */
export function skipRecheckField(
	versionMajor: number,
	versionMinor: number,
): "seedMode" | "skip_checking" {
	return versionMajor > 5 || (versionMajor === 5 && versionMinor >= 3)
		? "seedMode"
		: "skip_checking";
}
