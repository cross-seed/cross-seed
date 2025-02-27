import type { FieldApi } from '@tanstack/react-form';

export function FieldInfo({
  field,
  index,
}: {
  field: FieldApi<any, any, any, any>;
  index?: number;
}) {
  const errors = field.state.meta.errors;

  const getError = () => {
    if (typeof index === 'undefined') {
      return errors[0];
    }

    const errorArray =
      typeof errors[0] === 'string' ? errors[0]?.split(',') : [];
    return errorArray[index];
  };
  return (
    <>
      {field.state.meta.isTouched && errors && errors.length ? (
        <span className="text-sm text-red-600">{getError()}</span>
      ) : null}
    </>
  );
}
