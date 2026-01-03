/**
 * Remove any empty string values from an array of strings.
 * @param  array - The array of strings to filter.
 * @return - The filtered array with empty string values removed.
 */
export function removeEmptyArrayValues(array: string[]) {
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
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete obj[typedKey];
    }
  });

  return obj;
}
