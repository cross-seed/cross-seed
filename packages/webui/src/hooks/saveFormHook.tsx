import { useCallback } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { removeEmptyArrayValues } from '@/lib/transformers';

type SaveConfigArgs = {
  value: unknown;
  schema: z.ZodTypeAny;
  originalValues: Record<string, unknown>;
  successMessage?: string;
};

function isStringArray(value: unknown[]): value is string[] {
  return value.every((item) => typeof item === 'string');
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (isStringArray(value)) {
      return removeEmptyArrayValues(value);
    }

    return value.map((item) =>
      typeof item === 'object' && item !== null ? normalizeObject(item) : item,
    );
  }

  if (value && typeof value === 'object') {
    return normalizeObject(value as Record<string, unknown>);
  }

  return value;
}

function normalizeObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, val]) => [key, normalizeValue(val)]),
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }

  return JSON.stringify(a) === JSON.stringify(b);
}

export const useSaveConfigHook = () => {
  const trpc = useTRPC();
  const mutation = useMutation(
    trpc.settings.save.mutationOptions({
      onError: (error) => {
        console.error('Error saving config:', error);
      },
    }),
  );

  const save = useCallback(
    ({
      value,
      schema,
      originalValues,
      successMessage = 'Configuration saved successfully!',
    }: SaveConfigArgs) => {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        console.error('FULL VALIDATION FAILED:', parsed.error.format());
        toast.error('Validation failed', {
          description: 'Please correct the highlighted fields and try again.',
        });
        return;
      }

      const normalized = normalizeObject(
        parsed.data as Record<string, unknown>,
      );
      const patchEntries = Object.entries(normalized).filter(
        ([key, nextValue]) => {
          const originalValue = normalizeValue(originalValues[key]);
          return !valuesEqual(nextValue, originalValue);
        },
      );

      if (!patchEntries.length) {
        toast.info('No changes to save');
        return;
      }

      const patch = Object.fromEntries(patchEntries);

      mutation.mutate(patch, {
        onSuccess: () => {
          toast.success(successMessage, {
            description: 'Your changes will take effect on the next restart.',
          });
        },
      });
    },
    [mutation],
  );

  const saveAsync = useCallback(
    async ({
      value,
      schema,
      originalValues,
      successMessage = 'Configuration saved successfully!',
    }: SaveConfigArgs) => {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        console.error('FULL VALIDATION FAILED:', parsed.error.format());
        toast.error('Validation failed', {
          description: 'Please correct the highlighted fields and try again.',
        });
        return;
      }

      const normalized = normalizeObject(
        parsed.data as Record<string, unknown>,
      );
      const patchEntries = Object.entries(normalized).filter(
        ([key, nextValue]) => {
          const originalValue = normalizeValue(originalValues[key]);
          return !valuesEqual(nextValue, originalValue);
        },
      );

      if (!patchEntries.length) {
        toast.info('No changes to save');
        return;
      }

      const patch = Object.fromEntries(patchEntries);
      await mutation.mutateAsync(patch);
      toast.success(successMessage, {
        description: 'Your changes will take effect on the next restart.',
      });
    },
    [mutation],
  );

  return {
    saveConfig: save,
    saveConfigAsync: saveAsync,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
};
