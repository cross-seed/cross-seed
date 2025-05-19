import { FC } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from '@/contexts/Form/form-context';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FieldInfo } from './FieldInfo';
import RequiredIndicator from './required-indicator';
import useConfigForm from '@/hooks/use-config-form';

type TextFieldProps = React.HTMLProps<HTMLInputElement> & {
  className?: string;
  label: string;
};

const TextField: FC<TextFieldProps> = ({ className, label, ...rest }) => {
  const field = useFieldContext<string>();
  const { isFieldRequired } = useConfigForm();

  return (
    <div className={cn('space-y-3', className)}>
      <Label htmlFor={field.name} className="block w-full">
        {label}
        {isFieldRequired(field.name) && <RequiredIndicator />}
      </Label>
      <Input
        type="text"
        className="form-input"
        name={field.name}
        id={field.name}
        value={field.state.value ?? ''}
        aria-invalid={
          field.state.meta.isTouched && field.state.meta.errors?.length > 0
        }
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        {...rest}
      />
      <FieldInfo fieldMeta={field.state.meta} />
    </div>
  );
};

export default TextField;
