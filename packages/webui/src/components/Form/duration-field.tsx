import { DurationInput } from '@/components/DurationInput';
import { useFieldContext } from '@/contexts/Form/form-context';
import { useFormValidation } from '@/contexts/Form/use-form-validation-context';
import { Label } from '@/components/ui/label';
import { FieldInfo } from './FieldInfo';
import RequiredIndicator from './required-indicator';

type DurationFieldProps = {
  label: string;
  className?: string;
  hideLabel?: boolean;
};

const DurationField = ({
  label,
  className,
  hideLabel = false,
}: DurationFieldProps) => {
  const field = useFieldContext<number | null>();
  const { isFieldRequired } = useFormValidation();

  return (
    <div className={className}>
      {!hideLabel && (
        <Label htmlFor={field.name} className="mb-2 block">
          {label}
          {isFieldRequired(field.name) && (
            <span className="pl-1">
              <RequiredIndicator />
            </span>
          )}
        </Label>
      )}
      <DurationInput
        id={field.name}
        value={field.state.value ?? null}
        onBlur={field.handleBlur}
        onChange={(next) => field.handleChange(next)}
      />
      <FieldInfo fieldMeta={field.state.meta} />
    </div>
  );
};

export default DurationField;
