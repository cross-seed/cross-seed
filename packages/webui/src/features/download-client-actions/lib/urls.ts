export function getProtocolFromClientUrl(clientUrl: string) {
  const url = new URL(clientUrl);
  return url.protocol;
}

export function getHostFromClientUrl(clientUrl: string) {
  const url = new URL(clientUrl);
  return url.host;
}

export function getUsernameFromClientUrl(clientUrl: string) {
  const url = new URL(clientUrl);
  console.log('getusername fn', url);
}

export function getPasswordFromClientUrl(clientUrl: string) {
  const url = new URL(clientUrl);
  console.log('getpassword fn', url);
}

export const removeUserAndPassFromClientUrl = (url: string) => {
  try {
    const protocol = getProtocolFromClientUrl(url);
    const host = getHostFromClientUrl(url);
    return `${protocol}//${host}`;
  } catch (error) {
    // Gracefully degrade if an invalid URL sneaks in so the UI doesn't crash
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
    auth = username;
  }
  if (password) {
    auth += `:${password}`;
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
    auth += username;
  }
  if (password) {
    auth += `:${password}`;
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
