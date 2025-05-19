import type { FieldMeta } from '@tanstack/react-form';
import { FC } from 'react';

type FieldInfoProps = {
  fieldMeta: FieldMeta | undefined;
};

export const FieldInfo: FC<FieldInfoProps> = ({
  fieldMeta,
}: {
  fieldMeta: FieldMeta | undefined;
}) => {
  if (!fieldMeta) return null;

  if (fieldMeta.errors && fieldMeta.errors.length > 0) {
    return (
      <>
        {/* {fieldMeta.isTouched && fieldMeta.errors && fieldMeta.errors.length ? ( */}
        <span className="text-sm text-red-600">
          {fieldMeta.errors.map((error, i) => (
            <span key={i}>{error}</span>
          ))}
        </span>
        {/* )} */}
        {/* {field.state.meta.isTouched && errors && errors.length ? (
        <span className="text-sm text-red-600">{getError()}</span>
      ) : null} */}
      </>
    );
  }

  return null;
};
