import {
  fieldContext,
  // useFieldContext,
  formContext,
  // useFormContext,
  createFormHookContexts,
} from '@tanstack/react-form';
import TextField from '../text-field';
import SwitchField from '../switch-field';
import SelectField from '../select-field';

const { fieldContext, formContext } = createFormHookContexts();

const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    SwitchField,
    SelectField,
  },
});

export { useAppForm };
