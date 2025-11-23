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
import { useFormValidation } from '@/contexts/Form/use-form-validation-context';

type SelectFieldProps<T extends Record<string, string>> = {
  className?: string;
  label: string;
  options: T;
};

/**
 * Implementation example:
 * ```tsx
 * // For MatchMode
 *  import { MatchMode } from '@cross-seed/shared/constants';
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
  const { isFieldRequired } = useFormValidation();

  return (
    <div className={cn('space-y-3', className)}>
      <Label htmlFor={field.name} className="block w-full">
        {label}
        {isFieldRequired(field.name) && <RequiredIndicator />}
      </Label>
      {/* Adding `key` is kind of a hack to get Select to properly re-render on intial load */}
      <Select
        key={`${field.name}-${field.state.value}`}
        name={field.name}
        defaultValue={field.state.value as string}
        onValueChange={(value) => field.handleChange(value)}
      >
        <SelectTrigger className="w-full shadow-none">
          <SelectValue placeholder="Select a link type" />
        </SelectTrigger>
        <SelectContent>
          {Object.values(options).map((option) => (
            <SelectItem
              key={option.toLowerCase()}
              value={option.toLowerCase()}
              className="hover:bg-accent/50"
            >
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
