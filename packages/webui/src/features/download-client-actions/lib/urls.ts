const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeCredentialsForUrlParser = (rawUrl: string) => {
  const match = rawUrl.match(/^([a-z][a-z\d+\-.]*:\/\/)([^@]+)@(.+)$/i);
  if (!match) return rawUrl;

  const [, protocolPrefix, authPart, hostAndPath] = match;
  const separatorIdx = authPart.indexOf(':');
  if (separatorIdx === -1) return rawUrl;

  const rawUsername = authPart.slice(0, separatorIdx);
  const rawPassword = authPart.slice(separatorIdx + 1);
  const encodedUsername = encodeURIComponent(safeDecode(rawUsername));
  const encodedPassword = encodeURIComponent(safeDecode(rawPassword));
  return `${protocolPrefix}${encodedUsername}:${encodedPassword}@${hostAndPath}`;
};

const parseClientUrl = (clientUrl: string) =>
  new URL(normalizeCredentialsForUrlParser(clientUrl));

export function getProtocolFromClientUrl(clientUrl: string) {
  const url = parseClientUrl(clientUrl);
  return url.protocol;
}

export function getHostFromClientUrl(clientUrl: string) {
  const url = parseClientUrl(clientUrl);
  return url.host;
}

export function getUsernameFromClientUrl(clientUrl: string) {
  const url = parseClientUrl(clientUrl);
  console.log('getusername fn', url);
}

export function getPasswordFromClientUrl(clientUrl: string) {
  const url = parseClientUrl(clientUrl);
  console.log('getpassword fn', url);
}

export const removeUserAndPassFromClientUrl = (url: string) => {
  try {
    const parsedUrl = parseClientUrl(url);
    return `${parsedUrl.protocol}//${parsedUrl.host}`;
  } catch (error) {
    // Fallback for malformed legacy URLs: strip auth segment by using the last '@'.
    const protocolSeparator = '://';
    const protocolEnd = url.indexOf(protocolSeparator);
    const authStart =
      protocolEnd === -1 ? -1 : protocolEnd + protocolSeparator.length;
    const atIndex = url.lastIndexOf('@');

    if (authStart !== -1 && atIndex > authStart) {
      const rebuiltUrl = `${url.slice(0, authStart)}${url.slice(atIndex + 1)}`;
      try {
        const parsedFallback = new URL(rebuiltUrl);
        return `${parsedFallback.protocol}//${parsedFallback.host}`;
      } catch {
        return rebuiltUrl;
      }
    }

    // Gracefully degrade if an invalid URL sneaks in so the UI doesn't crash.
    console.warn('Unable to strip credentials from client URL', error);
    return url;
  }
};

export function buildClientTestUrl({
  client,
  protocol,
  host,
  username = '',
  password,
}: {
  client: string;
  protocol: string;
  host: string;
  username?: string;
  password?: string;
}) {
  let auth = '';
  if (client !== 'deluge' && username) {
    auth = encodeURIComponent(username);
  }
  if (password) {
    auth += `:${encodeURIComponent(password)}`;
  }
  auth += '@';
  const path = assignClientPath(client, false);
  const url = `${protocol}//${auth}${host}${path}`;
  return url;
}

export function buildClientUrl({
  client,
  protocol,
  host,
  username = '',
  password = '',
  readonly = false,
  usePlugin = false,
}: {
  client: string;
  protocol: string;
  host: string;
  username?: string;
  password?: string;
  readonly?: boolean;
  usePlugin?: boolean;
}) {
  let auth = '';
  if (username) {
    auth += encodeURIComponent(username);
  }
  if (password) {
    auth += `:${encodeURIComponent(password)}`;
  }
  auth += '@';
  const path = assignClientPath(client, usePlugin);
  const url = `${client.toLowerCase()}:${readonly ? 'readonly:' : ''}${protocol}//${auth}${host}${path}`;
  return url;
}

function assignClientPath(client: string, usePlugin: boolean) {
  switch (client.toLowerCase()) {
    case 'qbittorrent':
      return '';
    case 'transmission':
      return '/transmission/rpc';
    case 'deluge':
      return '/json';
    case 'rtorrent':
      return usePlugin ? '/rutorrent/plugins/httprpc/action.php' : '/RPC2';
    default:
      return '';
  }
}
