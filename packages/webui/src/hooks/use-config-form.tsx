import { Config } from '@/types/config';
import { ZodObject, ZodRawShape } from 'zod';

export const useConfigForm = (schema: ZodObject<ZodRawShape>) => {
  const isFieldRequired = (field: string) => {
    const schemaField = schema.shape[field as keyof Config];
    if (!schemaField) {
      console.warn(`Field "${field}" not found in schema.`);
      return false;
    }
    return !schemaField.isOptional() && !schemaField.isNullable();
  };

  return {
    isFieldRequired,
  };
};

export default useConfigForm;

// export const defaultValues = formOptions({
//   defaultValues: defaultConfig,
// });

// export const validationSchema = baseValidationSchema;
