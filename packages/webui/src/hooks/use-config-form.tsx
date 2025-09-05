import { useTRPC } from '@/lib/trpc';
import { baseValidationSchema } from '@/types/config';
import { useSuspenseQuery } from '@tanstack/react-query';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { Config } from '@/types/config';
import { ZodObject, ZodRawShape } from 'zod';
// import { defaultConfig } from '../../../shared/constants';
// import { formOptions } from '@tanstack/react-form';

export const useConfigForm = (schema: ZodObject<ZodRawShape>) => {
  const trpc = useTRPC();

  const { data: config } = useSuspenseQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data) => formatConfigDataForForm(data.config),
    }),
  );

  const isFieldRequired = (field: string) => {
    const schemaField = schema.shape[field as keyof Config];
    if (!schemaField) {
      console.warn(`Field "${field}" not found in schema.`);
      return false;
    }
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
