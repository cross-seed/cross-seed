import { useTRPC } from "@/lib/trpc";
import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useSaveConfigHook = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const options = trpc.settings.save.mutationOptions({
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: trpc.settings.get.queryKey(),
        exact: false,
      });
      await queryClient.invalidateQueries({ queryKey: trpc.library.pathKey() });
      await queryClient.invalidateQueries({
        queryKey: trpc.stats.getOverview.pathKey(),
      });
      toast.success("Settings saved successfully!");
    },
    onError: (error) => {
      toast.error("Failed to save settings", {
        description: error.message || "An unknown error occurred",
      });
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
