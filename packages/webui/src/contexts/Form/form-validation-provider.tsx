import { ReactNode } from 'react';
import { FormValidationContext } from './form-validation-context';

export const FormValidationProvider = ({
  isFieldRequired,
  children,
}: {
  isFieldRequired: (fieldName: string) => boolean;
  children: ReactNode;
}) => {
  return (
    <FormValidationContext.Provider value={{ isFieldRequired }}>
      {children}
    </FormValidationContext.Provider>
  );
};
