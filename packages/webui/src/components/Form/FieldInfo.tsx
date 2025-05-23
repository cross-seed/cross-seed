import type { AnyFieldMeta } from '@tanstack/react-form';
import { FC } from 'react';

type FieldInfoProps = {
  fieldMeta: AnyFieldMeta | undefined;
};

export const FieldInfo: FC<FieldInfoProps> = ({
  fieldMeta,
}: {
  fieldMeta: AnyFieldMeta | undefined;
}) => {
  if (!fieldMeta) return null;

  if (fieldMeta.errors && fieldMeta.errors.length > 0) {
    return (
      <>
        <span className="text-sm text-red-600">
          {fieldMeta.errors.map((error, i) => {
            if (typeof error === 'object' && error !== null) {
              // Handle the case where error is an object
              return (
                <span key={i}>{error?.message || JSON.stringify(error)}</span>
              );
            }
            return <span key={i}>{error}</span>;
          })}
        </span>
      </>
    );
  }

  return null;
};
