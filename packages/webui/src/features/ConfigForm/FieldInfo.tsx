import type { FieldApi } from '@tanstack/react-form';

export function FieldInfo({ field }: { field: FieldApi<any, any, any, any> }) {
  return (
    <>
      {field.state.meta.errors.length ? (
        // {field.state.meta.isTouched && field.state.meta.errors.length ? (
        <span className="text-red-600">
          {field.state.meta.errors.join(', ')}
        </span>
      ) : null}
      {field.state.meta.isValidating ? 'Validating...' : null}
    </>
  );
}
