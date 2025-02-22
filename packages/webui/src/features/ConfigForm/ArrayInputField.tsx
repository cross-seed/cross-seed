import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldInfo } from './FieldInfo';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FC, useState } from 'react';
import { FieldApi } from '@tanstack/react-form';

type ArrayInputFieldProps = {
  field: FieldApi<any, any, any, any>;
  label: string;
  required?: boolean;
  buttonLabel?: string;
  inputType?: string;
};

export const ArrayInputField: FC<ArrayInputFieldProps> = ({
  field,
  label,
  required,
  buttonLabel,
  inputType = 'text',
}) => {
  const [fieldValue, setFieldValue] = useState('');

  return (
    <div className="space-y-3">
      <Label htmlFor={field.name} className="block w-full">
        {label}
        {required && <span className="pl-1 text-red-500">*</span>}
      </Label>
      {field.state.value.map((value: string, index: number) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type={inputType}
            className="form-input focus-visible:ring-accent"
            id={field.name}
            name={field.name}
            value={value}
            onChange={(e) => {
              const newValues = [...field.state.value];
              newValues[index] = e.target.value;
              field.setValue(newValues);
            }}
          />
          <Button
            onClick={() => {
              const newValues = field.state.value.filter(
                (_: unknown, i: number) => i !== index,
              );
              field.handleChange(newValues);
            }}
            className="rounded bg-slate-100 px-4 py-1 text-slate-400 hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white"
          >
            <FontAwesomeIcon icon={faTrash} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          type={inputType}
          className="form-input focus-visible:ring-accent"
          id={field.name}
          name={field.name}
          value={fieldValue}
          onChange={(e) => setFieldValue(e.target.value)}
        />
        {/* Add new URL button */}
        <Button
          variant="outline"
          disabled={!fieldValue}
          onClick={() => {
            field.handleChange([...field.state.value, fieldValue]);
            setFieldValue('');
          }}
          className="h-auto rounded px-2 py-2"
          title={`Add ${field.name}`}
        >
          {buttonLabel ?? 'Add'}
        </Button>
      </div>
      <FieldInfo field={field} />
    </div>
  );
};
