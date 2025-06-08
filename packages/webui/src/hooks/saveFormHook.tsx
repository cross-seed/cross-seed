import { useTRPC } from '@/lib/trpc';
import { useMutation } from '@tanstack/react-query';

export const useSaveConfigHook = () => {
  const trpc = useTRPC();
  const options = trpc.settings.save.mutationOptions({
    onSuccess: (data) => {
      console.log('Config saved successfully:', data);
    },
    onError: (error) => {
      console.error('Error saving config:', error);
    },
  });

  const mutation = useMutation(options);

  return {
    saveConfig: mutation.mutate,
    saveConfigAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
};
