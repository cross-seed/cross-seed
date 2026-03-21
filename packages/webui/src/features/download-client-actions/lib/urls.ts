const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeCredentialsForUrlParser = (rawUrl: string) => {
  const protocolSeparator = '://';
  const protocolEnd = rawUrl.indexOf(protocolSeparator);
  if (protocolEnd === -1) return rawUrl;

  const authStart = protocolEnd + protocolSeparator.length;
  const atIndex = rawUrl.lastIndexOf('@');
  if (atIndex <= authStart) return rawUrl;

  const authPart = rawUrl.slice(authStart, atIndex);
  const separatorIdx = authPart.indexOf(':');
  if (separatorIdx === -1) return rawUrl;

  const rawUsername = authPart.slice(0, separatorIdx);
  const rawPassword = authPart.slice(separatorIdx + 1);
  const encodedUsername = encodeURIComponent(safeDecode(rawUsername));
  const encodedPassword = encodeURIComponent(safeDecode(rawPassword));
  return `${rawUrl.slice(0, authStart)}${encodedUsername}:${encodedPassword}${rawUrl.slice(atIndex)}`;
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
  return safeDecode(url.username);
}

export function getPasswordFromClientUrl(clientUrl: string) {
  const url = parseClientUrl(clientUrl);
  return safeDecode(url.password);
}

export const removeUserAndPassFromClientUrl = (url: string) => {
  try {
    const parsedUrl = parseClientUrl(url);
    return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
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

function buildEndpointUrlWithAuth({
  endpointUrl,
  username = '',
  password = '',
  includeUsername = true,
}: {
  endpointUrl: string;
  username?: string;
  password?: string;
  includeUsername?: boolean;
}) {
  const url = parseClientUrl(removeUserAndPassFromClientUrl(endpointUrl));
  url.username = includeUsername ? username : '';
  url.password = password;
  return url.toString();
}

export function buildClientUrl({
  client,
  endpointUrl,
  username = '',
  password = '',
  readonly = false,
}: {
  client: string;
  endpointUrl: string;
  username?: string;
  password?: string;
  readonly?: boolean;
}) {
  const url = buildEndpointUrlWithAuth({
    endpointUrl,
    username,
    password,
    includeUsername: client.toLowerCase() !== 'deluge',
  });
  return `${client.toLowerCase()}:${readonly ? 'readonly:' : ''}${url}`;
}

export function buildClientTestUrl({
  client,
  endpointUrl,
  username = '',
  password = '',
}: {
  client: string;
  endpointUrl: string;
  username?: string;
  password?: string;
}) {
  return buildEndpointUrlWithAuth({
    endpointUrl,
    username,
    password,
    includeUsername: client.toLowerCase() !== 'deluge',
  });
}
