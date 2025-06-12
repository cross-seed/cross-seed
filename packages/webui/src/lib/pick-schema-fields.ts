import { z } from 'zod';

type StringKeyRecord = Record<string, unknown>;
type SchemaKeys<T extends z.ZodRawShape> = keyof T & string;

interface PickOptions {
  readonly includeUndefined?: boolean;
  readonly preserveArrays?: boolean;
}

/**
 * Picks only the fields that are defined in the provided Zod schema from the given object
 * @param schema - Zod schema object (must have a 'shape' property)
 * @param data - Object to pick fields from
 * @returns New object containing only the fields present in the schema
 */
export function pickSchemaFields<
  TSchema extends z.ZodRawShape,
  TData extends StringKeyRecord
>(
  schema: z.ZodObject<TSchema>,
  data: TData,
  options: PickOptions = {}
): Partial<z.infer<z.ZodObject<TSchema>>> {
  const { includeUndefined = false, preserveArrays = true } = options;
  const schemaKeys = Object.keys(schema.shape) as SchemaKeys<TSchema>[];
  
  const result: StringKeyRecord = {};
  
  for (const key of schemaKeys) {
    const value = data[key];
    
    if (includeUndefined || key in data) {
      // Handle arrays
      if (preserveArrays && Array.isArray(value)) {
        result[key] = value;
      }
      // Handle nested objects
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const schemaField = schema.shape[key];
        if (schemaField instanceof z.ZodObject) {
          result[key] = pickSchemaFields(
            schemaField, 
            value as StringKeyRecord, 
            options
          );
        } else {
          result[key] = value;
        }
      }
      // Handle primitive values
      else {
        result[key] = value;
      }
    }
  }
  
  return result as Partial<z.infer<z.ZodObject<TSchema>>>;
}

