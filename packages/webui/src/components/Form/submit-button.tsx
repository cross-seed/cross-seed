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
        selector={(state) => [
          state.canSubmit,
          state.isSubmitting,
          state.errors,
          state.fieldMeta,
        ]}
      >
        {([canSubmit, isSubmitting, errors, fieldMeta]) => (
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
            {Object.keys(errors).length > 0 && (
              <div className="mt-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
                <h4 className="font-medium">
                  Please fix the following errors:
                </h4>
                <ul className="mt-2 list-disc pl-5">
                  {JSON.stringify(fieldMeta)}
                  {Object.entries(errors).map(([field, error]) => (
                    <li key={field}>
                      {field}:{' '}
                      {typeof error === 'string'
                        ? error
                        : JSON.stringify(error)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </form.Subscribe>

      {/* Debugging section */}
      {/* <form.Subscribe> */}
      {/*   {(state) => ( */}
      {/*     <div */}
      {/*       className="bg-card text-card-foreground w-lg overflow-auto p-4 shadow-lg" */}
      {/*       style={{ opacity: 0.9 }} */}
      {/*     > */}
      {/*       <h3 className="mb-2 text-lg font-bold">Form Debug</h3> */}
      {/*       <button */}
      {/*         onClick={(e) => { */}
      {/*           e.preventDefault(); */}
      {/*           console.log('Full form state:', state); */}
      {/**/}
      {/*           // Test validate all fields */}
      {/*           Object.keys(state.fields).forEach((fieldName) => { */}
      {/*             try { */}
      {/*               if (baseValidationSchema.shape[fieldName]) { */}
      {/*                 const validationResult = baseValidationSchema.shape[ */}
      {/*                   fieldName */}
      {/*                 ].safeParse(state.values[fieldName]); */}
      {/*                 if (!validationResult.success) { */}
      {/*                   console.error( */}
      {/*                     `Field ${fieldName} validation failed:`, */}
      {/*                     validationResult.error, */}
      {/*                   ); */}
      {/*                 } */}
      {/*               } */}
      {/*             } catch (e) { */}
      {/*               console.error(`Error validating ${fieldName}:`, e); */}
      {/*             } */}
      {/*           }); */}
      {/*         }} */}
      {/*         className="mb-2 rounded bg-blue-500 px-2 py-1 text-white" */}
      {/*       > */}
      {/*         Log State */}
      {/*       </button> */}
      {/*       <div className="text-xs"> */}
      {/*         <pre className="overflow-auto"> */}
      {/*           {JSON.stringify( */}
      {/*             { */}
      {/*               errors: Object.fromEntries( */}
      {/*                 Object.entries(state.fieldMeta) */}
      {/*                   .filter(([_, meta]) => meta.errors?.length > 0) */}
      {/*                   .map(([name, meta]) => [name, meta.errors]), */}
      {/*               ), */}
      {/*               hasErrors: !state.canSubmit, */}
      {/*             }, */}
      {/*             null, */}
      {/*             2, */}
      {/*           )} */}
      {/*         </pre> */}
      {/*       </div> */}
      {/*     </div> */}
      {/*   )} */}
      {/* </form.Subscribe> */}
    </>
  );
}

export default SubmitButton;
