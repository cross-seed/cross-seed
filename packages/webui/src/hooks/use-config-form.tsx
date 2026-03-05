import { useTRPC } from '@/lib/trpc';
import { baseValidationSchema } from '@/types/config';
import { useSuspenseQuery } from '@tanstack/react-query';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { Config } from '@/types/config';
import { ZodEffects, ZodObject, ZodRawShape, ZodTypeAny } from 'zod';

export const useConfigForm = (schema: ZodObject<ZodRawShape>) => {
  const trpc = useTRPC();

  const { data: config } = useSuspenseQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data) => formatConfigDataForForm(data.config),
    }),
  );

  const isFieldRequired = (field: string) => {
    let schemaField: ZodTypeAny | undefined = schema.shape[field as keyof Config];
    if (!schemaField) {
      console.warn(`Field "${field}" not found in schema.`);
      return false;
    }
    // Unwrap ZodEffects (.transform(), .refine(), etc.)
    while (schemaField instanceof ZodEffects) {
      schemaField = schemaField._def.schema;
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
