import { FC } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from '@/contexts/Form/form-context';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FieldInfo } from './FieldInfo';
import RequiredIndicator from './required-indicator';
import { useFormValidation } from '@/contexts/Form/use-form-validation-context';

type NumberFieldProps = React.HTMLProps<HTMLInputElement> & {
  className?: string;
  label: string;
  hideLabel?: boolean;
};

/**
 * NumberField component for use with the form library.
 * It provides a number input field with label, error handling, and required indicator.
 *
 * @param props - The props for the NumberField component.
 * @returns  The rendered NumberField component.
 *
 * @example
 * <NumberField label="Name" />
 */

const NumberField: FC<NumberFieldProps> = ({
  className,
  label,
  hideLabel = false,
  ...rest
}) => {
  const field = useFieldContext<number | null>();
  const { isFieldRequired } = useFormValidation();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string to clear the field
    if (value === '') {
      field.handleChange(null);
      return;
    }
    const numberValue = Number(value);
    if (!isNaN(numberValue)) {
      field.handleChange(numberValue);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      {!hideLabel && (
        <Label htmlFor={field.name} className="block w-full">
          {label}
          {isFieldRequired(field.name) && <RequiredIndicator />}
        </Label>
      )}
      <Input
        type="number"
        className="form-input"
        name={field.name}
        id={field.name}
        value={field.state.value ?? ''}
        aria-invalid={
          field.state.meta.isTouched && field.state.meta.errors?.length > 0
        }
        onBlur={field.handleBlur}
        onChange={onChange}
        {...rest}
      />
      <FieldInfo fieldMeta={field.state.meta} />
    </div>
  );
};

export default NumberField;
