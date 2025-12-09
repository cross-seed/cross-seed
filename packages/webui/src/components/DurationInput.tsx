import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DEFAULT_DURATION_UNITS = [
  {
    label: 'Millisecond',
    labelPlural: 'Milliseconds',
    value: 'milliseconds',
    ms: 1,
  },
  { label: 'Second', labelPlural: 'Seconds', value: 'seconds', ms: 1000 },
  { label: 'Minute', labelPlural: 'Minutes', value: 'minutes', ms: 60 * 1000 },
  { label: 'Hour', labelPlural: 'Hours', value: 'hours', ms: 60 * 60 * 1000 },
  { label: 'Day', labelPlural: 'Days', value: 'days', ms: 24 * 60 * 60 * 1000 },
] as const;

type DurationUnit = (typeof DEFAULT_DURATION_UNITS)[number];

export type DurationUnitValue = DurationUnit['value'];

export type DurationInputProps = {
  id?: string;
  className?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  units?: DurationUnit[];
  disabled?: boolean;
};

/**
 * Compound duration input that keeps values as milliseconds while letting
 * the user pick the unit. We keep the numeric precision by formatting the
 * value ourselves instead of relying on `ms` to stringify the duration.
 */
export function DurationInput({
  id,
  className,
  value,
  onChange,
  onBlur,
  units = DEFAULT_DURATION_UNITS,
  disabled = false,
}: DurationInputProps) {
  const unitList = useMemo(() => units, [units]);
  const normalizedValue = useMemo(() => normalizeDurationValue(value), [value]);
  const [selectedUnit, setSelectedUnit] = useState<DurationUnitValue>(() => {
    if (normalizedValue != null) {
      return pickBestUnit(normalizedValue, unitList).value;
    }
    return unitList[2]?.value ?? unitList[0].value;
  });
  const [inputValue, setInputValue] = useState('');
  const [hasUserLockedUnit, setHasUserLockedUnit] = useState(false);

  const selectedUnitConfig =
    unitList.find((unit) => unit.value === selectedUnit) ?? unitList[0];
  const parsedInputValue = parseDurationInput(inputValue);
  const selectedUnitLabel = getUnitLabel(selectedUnitConfig, parsedInputValue);

  useEffect(() => {
    if (!hasUserLockedUnit && normalizedValue != null) {
      const bestUnit = pickBestUnit(normalizedValue, unitList);
      if (bestUnit.value !== selectedUnit) {
        setSelectedUnit(bestUnit.value);
      }
    }
  }, [hasUserLockedUnit, normalizedValue, selectedUnit, unitList]);

  useEffect(() => {
    if (normalizedValue == null) {
      setInputValue('');
      return;
    }

    const unit =
      unitList.find((option) => option.value === selectedUnit) ?? unitList[0];
    setInputValue(formatDurationValue(normalizedValue, unit.ms));
  }, [normalizedValue, selectedUnit, unitList]);

  const handleValueChange = (next: string) => {
    setHasUserLockedUnit(true);
    setInputValue(next);

    const parsed = parseDurationInput(next);
    if (parsed == null) {
      onChange(null);
      return;
    }
    onChange(parsed * selectedUnitConfig.ms);
  };

  const handleUnitChange = (nextUnitValue: DurationUnitValue) => {
    setHasUserLockedUnit(true);
    setSelectedUnit(nextUnitValue);
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Input
        id={id}
        name={id}
        type="number"
        min={0}
        step="any"
        className="flex-1 shadow-none"
        value={inputValue}
        onBlur={onBlur}
        inputMode="decimal"
        disabled={disabled}
        onChange={(event) => handleValueChange(event.target.value)}
      />
      <Select
        value={selectedUnitConfig.value}
        onValueChange={handleUnitChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-32 shadow-none">
          <SelectValue aria-label={selectedUnitLabel}>
            {selectedUnitLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {unitList.map((unit) => (
            <SelectItem key={unit.value} value={unit.value}>
              {unit.labelPlural ?? `${unit.label}s`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function pickBestUnit(value: number, units: readonly DurationUnit[]) {
  if (!Number.isFinite(value) || value <= 0) {
    return units[0];
  }

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (value >= unit.ms) {
      return unit;
    }
  }

  return units[0];
}

function parseDurationInput(input: string): number | null {
  if (!input || input.trim() === '') {
    return null;
  }

  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function formatDurationValue(valueMs: number, unitMs: number) {
  if (unitMs === 0) return '';

  const numericValue = valueMs / unitMs;
  if (Number.isInteger(numericValue)) {
    return numericValue.toString();
  }

  return trimTrailingZeros(numericValue.toFixed(6));
}

function trimTrailingZeros(value: string) {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

function normalizeDurationValue(
  value: number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getUnitLabel(unit: DurationUnit, quantity: number | null) {
  if (quantity == null || quantity !== 1) {
    return unit.labelPlural ?? `${unit.label}s`;
  }

  return unit.label;
}
