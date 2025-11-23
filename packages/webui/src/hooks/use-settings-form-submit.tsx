import { useCallback } from 'react';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues, removeNullFields } from '@/lib/transformers';

export function useSettingsFormSubmit() {
  const { saveConfig } = useSaveConfigHook();

  return useCallback(
    async ({ value }: { value: unknown }) => {
      try {
        Object.keys(value).forEach((attr) => {
          const key = attr as keyof typeof value;
          const val = value[key];
          if (val && Array.isArray(val)) {
            value[key] = removeEmptyArrayValues(val);
          }
        });

        removeNullFields(value as Record<string, unknown>);

        await saveConfig(value);
        return { value };
      } catch (err) {
        console.error('Exception:', err);
        return {
          status: 'error',
          error: { _form: 'An unexpected error occurred' },
        };
      }
    },
    [saveConfig],
  );
}
