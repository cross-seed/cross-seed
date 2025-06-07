import { useAppForm } from '@/hooks/form';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useTRPC } from '@/lib/trpc';
import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { defaultConfig } from '../../../../shared/constants';
import { baseValidationSchema } from '@/types/config';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { ConfigFormContext } from './config-form-context';

export function ConfigFormProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const { data: configData, isLoading } = useQuery(
    trpc.config.get.queryOptions(undefined, {
      select: (data) => formatConfigDataForForm(data.config),
    }),
  );

  const { saveConfig } = useSaveConfigHook();

  const form = useAppForm({
    defaultValues: configData ?? defaultConfig,
    onSubmit: async ({ value }) => {
      // Full schema validation
      // Fake a long response delay
      // setTimeout(() => {
      try {
        const result = baseValidationSchema.safeParse(value);
        if (!result.success) {
          console.error('FULL VALIDATION FAILED:', result.error.format());
        } else {
          // remove empty values from array fields
          Object.keys(value).forEach((attr) => {
            const val = value[attr as keyof typeof configData];
            if (val && Array.isArray(val)) {
              value[attr as keyof typeof configData] =
                removeEmptyArrayValues(val);
            }
          });

          saveConfig(value);
        }
      } catch (err) {
        console.error('Exception during full validation:', err);
        return {
          status: 'error',
          error: { _form: 'An unexpected error occurred during validation' },
        };
      }
      // }, 2000);
    },
    validators: {
      onSubmit: baseValidationSchema,
    },
  });

  return (
    <ConfigFormContext.Provider value={{ form, isLoading, saveConfig }}>
      {children}
    </ConfigFormContext.Provider>
  );
}
