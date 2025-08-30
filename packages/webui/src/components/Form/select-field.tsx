import { cn } from '@/lib/utils';
import { useFieldContext } from '@/contexts/Form/form-context';
import { Label } from '@/components/ui/label';
import { FieldInfo } from './FieldInfo';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import RequiredIndicator from './required-indicator';
import useConfigForm from '@/hooks/use-config-form';

type SelectFieldProps<T extends Record<string, string>> = {
  className?: string;
  label: string;
  options: T;
};

/**
 * Implementation example:
 * ```tsx
 * // For MatchMode
 *  import { MatchMode } from 'packages/shared/constants';
 *
 *  <SelectField
 *    label="Match Mode"
 *    options={MatchMode}
 *    placeholder="Select a match mode"
 *  />
 * ```
 */

function SelectField<T extends Record<string, string>>({
  className,
  label,
  options,
}: SelectFieldProps<T>) {
  const field = useFieldContext();
  const { isFieldRequired } = useConfigForm();

  return (
    <div className={cn('space-y-3', className)}>
      <Label htmlFor={field.name} className="block w-full">
        {label}
        {isFieldRequired(field.name) && <RequiredIndicator />}
      </Label>
      <Select
        name={field.name}
        defaultValue={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
      >
        <SelectTrigger className="w-full shadow-none">
          <SelectValue placeholder="Select a link type" />
        </SelectTrigger>
        <SelectContent>
          {Object.values(options).map((option) => (
            <SelectItem key={option.toLowerCase()} value={option.toLowerCase()}>
              {option.toLowerCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldInfo fieldMeta={field.state.meta} />
    </div>
  );
}

export default SelectField;
