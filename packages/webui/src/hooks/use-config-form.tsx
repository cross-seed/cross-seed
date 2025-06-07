import { useTRPC } from '@/lib/trpc';
import { baseValidationSchema } from '@/types/config';
import { useSuspenseQuery } from '@tanstack/react-query';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { Config } from '@/types/config';
// import { defaultConfig } from '../../../shared/constants';
// import { formOptions } from '@tanstack/react-form';

export const useConfigForm = () => {
  const trpc = useTRPC();
  const { data: config } = useSuspenseQuery(
    trpc.config.get.queryOptions(undefined, {
      select: (data) => formatConfigDataForForm(data.config),
    }),
  );

  const isFieldRequired = (field: string) => {
    const schemaField = baseValidationSchema.shape[field as keyof Config];
    return !schemaField.isOptional() && !schemaField.isNullable();
  };

  return {
    config,
    validationSchema: baseValidationSchema,
    isFieldRequired,
  };
};

export default useConfigForm;

// export const defaultValues = formOptions({
//   defaultValues: defaultConfig,
// });

// export const validationSchema = baseValidationSchema;
