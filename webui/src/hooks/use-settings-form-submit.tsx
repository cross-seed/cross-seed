import { useCallback } from 'react';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues, removeNullFields } from '@/lib/transformers';

export function useSettingsFormSubmit() {
  const { saveConfigAsync } = useSaveConfigHook();

  return useCallback(
    async ({ value }: { value: Record<string, unknown> }) => {
      try {
        Object.keys(value).forEach((attr) => {
          const val = value[attr];
          if (val && Array.isArray(val)) {
            value[attr] = removeEmptyArrayValues(val);
          }
        });

        removeNullFields(value);

        await saveConfigAsync(value);
        return { value };
      } catch (err) {
        console.error('Exception:', err);
        return {
          status: 'error',
          error: { _form: 'An unexpected error occurred' },
        };
      }
    },
    [saveConfigAsync],
  );
}
