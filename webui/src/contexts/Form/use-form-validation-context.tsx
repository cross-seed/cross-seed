import { useContext } from 'react';
import { FormValidationContext } from './form-validation-context';

export const useFormValidation = () => {
  const context = useContext(FormValidationContext);
  if (!context) {
    throw new Error(
      'useFormValidation must be used within a FormValidationProvider',
    );
  }
  return context;
};
