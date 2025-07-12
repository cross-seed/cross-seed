import { createContext } from 'react';

interface FormValidationContextValue {
  isFieldRequired: (fieldName: string) => boolean;
}

export const FormValidationContext = createContext<FormValidationContextValue | null>(null);
