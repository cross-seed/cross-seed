import { createContext } from 'react';
import { useAppForm } from '@/hooks/form';
import { Config } from '@/types/config';

type configFormType = ReturnType<typeof useAppForm>;

interface ConfigFormContextType {
  form: configFormType;
  isLoading: boolean;
  saveConfig: (data: Config) => Promise<void>;
}

export const ConfigFormContext = createContext<ConfigFormContextType | null>(
  null,
);
