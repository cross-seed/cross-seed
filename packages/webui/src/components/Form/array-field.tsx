import { useFieldContext } from '@/contexts/Form/form-context';
import { cn } from '@/lib/utils';
import { FC } from 'react';
import { Input } from '@/components/ui/input';
import DeleteOption from '../Buttons/DeleteOption';

type ArrayFieldProps = {
  className?: string;
  index: number;
  showDelete?: boolean;
  onDelete: () => void;
};

const ArrayField: FC<ArrayFieldProps> = ({
  className,
  showDelete = false,
  onDelete,
}) => {
  const field = useFieldContext();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        type="text"
        id={`${field.name}`}
        className="form-input"
        value={field.state.value ? String(field.state.value) : ''}
        aria-invalid={
          !!(
            field.state.meta.isTouched &&
            (field.state.meta.errorMap.onBlur as string)?.length > 0
          )
        }
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {showDelete && <DeleteOption onClick={onDelete} />}
    </div>
  );
};

export default ArrayField;
