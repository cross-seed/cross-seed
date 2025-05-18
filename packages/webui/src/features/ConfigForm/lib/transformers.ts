/**
 * Remove any empty string values from an array of strings.
 * @param  array - The array of strings to filter.
 * @return - The filtered array with empty string values removed.
 */
export function removeEmptyArrayValues(array: string[]) {
  return array.filter((item) => item !== '');
}
