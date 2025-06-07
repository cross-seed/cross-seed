import { useContext } from 'react';
import { ConfigFormContext } from './config-form-context';

export function useConfigFormContext() {
  const context = useContext(ConfigFormContext);
  if (!context) {
    throw new Error('useConfigForm must be used within ConfigFormProvider');
  }
  return context;
}
