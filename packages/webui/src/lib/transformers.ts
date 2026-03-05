/**
 * Remove any empty string values from an array.
 * @param  array - The array to filter.
 * @return - The filtered array with empty string values removed.
 */
export function removeEmptyArrayValues(array: unknown[]) {
  return array.filter((item) => item !== '');
}

/**
 * Removes keys whose value is strictly null from the provided object. This helps
 * translate form fields that use null to mean "unset" into `undefined` so the
 * backend can omit the field entirely.
 */
export function removeNullFields<T extends Record<string, unknown>>(obj: T) {
  Object.keys(obj).forEach((key) => {
    const typedKey = key as keyof T;
    if (obj[typedKey] === null) {
      delete obj[typedKey];
    }
  });

  return obj;
}
