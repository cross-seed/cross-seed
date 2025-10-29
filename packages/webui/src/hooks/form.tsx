import { createFormHook } from '@tanstack/react-form';
import { lazy } from 'react';
import { fieldContext, formContext } from '../contexts/Form/form-context';

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField: lazy(() => import('@/components/Form/text-field')),
    SwitchField: lazy(() => import('@/components/Form/switch-field')),
    SelectField: lazy(() => import('@/components/Form/select-field')),
    ArrayField: lazy(() => import('@/components/Form/array-field')),
  },
  formComponents: {
    SubmitButton: lazy(() => import('@/components/Form/submit-button')),
  },
});
