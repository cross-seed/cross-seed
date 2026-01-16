import { FC } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from '@/contexts/Form/form-context';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type SwitchFieldProps = {
  className?: string;
  label: string;
};

const SwitchField: FC<SwitchFieldProps> = ({ className, label }) => {
  const field = useFieldContext();
  return (
    <div className={cn('form-field__switch flex items-center', className)}>
      <Label htmlFor={field.name} className="mr-3">
        {label}
      </Label>
      <Switch
        id={field.name}
        checked={field.state.value}
        onCheckedChange={field.handleChange}
      />
    </div>
  );
};

export default SwitchField;
