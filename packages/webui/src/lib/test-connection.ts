import { trpcClient } from './trpc';

export const testConnection = async ({
  client,
  url,
  username = '',
  password,
}: {
  client: string;
  url: string;
  username: string;
  password: string;
}): Promise<{ success: boolean }> => {
  try {
    const result = await trpcClient.clients.testConnection.mutate({
      client: client.toLowerCase(),
      url,
      username,
      password,
      readonly: false,
    });

    return { success: result.success };
  } catch (error) {
    console.error('Error testing connection:', error);
    return { success: false };
  }
};
