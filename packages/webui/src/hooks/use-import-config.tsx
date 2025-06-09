import { useTRPC } from '@/lib/trpc';
import { useMutation } from '@tanstack/react-query';

export const useImportConfig = () => {
  const trpc = useTRPC();

  const options = trpc.settings.save.mutationOptions({
    onSuccess: () => {
      // Optionally handle success, e.g., show a notification
    },
    onError: (error) => {
      console.error('Error saving config:', error);
      // Optionally handle error, e.g., show an error notification
    },
  });

  const mutation = useMutation(options);

  return {
    importConfig: mutation.mutate,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
  };
};
