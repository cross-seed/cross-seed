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
            className="form-input"
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
            className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
          >
            <FontAwesomeIcon icon={faTrash} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          type={inputType}
          className="form-input"
          id={field.name}
          name={field.name}
          value={fieldValue}
          onChange={(e) => setFieldValue(e.target.value)}
        />
        {/* Add new URL button */}
        <Button
          disabled={!fieldValue}
          variant="secondary"
          onClick={() => {
            field.handleChange([...field.state.value, fieldValue]);
            setFieldValue('');
          }}
          className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
          title={`Add ${field.name}`}
        >
          {buttonLabel ?? 'Add'}
        </Button>
      </div>
      <FieldInfo field={field} />
    </div>
  );
};
