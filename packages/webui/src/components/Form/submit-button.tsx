import { useFormContext } from '@/contexts/Form/form-context';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubmitButtonProps {
  label?: string;
  actionLabel?: string;
  size?: 'sm' | 'md' | 'lg';
}

function SubmitButton({ label, actionLabel, size = 'md' }: SubmitButtonProps) {
  const form = useFormContext();

  return (
    <>
      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting]}
      >
        {([canSubmit, isSubmitting]) => (
          <div className="form__submit bg-background sticky right-0 bottom-0 left-0 w-full pt-4">
            <Button
              type="submit"
              className={cn(
                'w-full rounded-md transition-colors duration-150',
                {
                  'opacity-70': isSubmitting,
                  'px-4 py-6': size === 'lg',
                  'px-4 py-2': size === 'md',
                  'px-2 py-1': size === 'sm',
                },
              )}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />{' '}
                  {actionLabel ?? 'Saving...'}
                </>
              ) : (
                <>{label ?? 'Save'}</>
              )}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </>
  );
}

export default SubmitButton;
