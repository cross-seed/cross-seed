import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Page } from '@/components/Page';

function DebugSettings() {
  const [jsonValue, setJsonValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [parseError, setParseError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: settingsData, isLoading } = useQuery(
    trpc.settings.get.queryOptions(),
  );

  const saveMutation = useMutation(
    trpc.settings.replace.mutationOptions({
      onSuccess: () => {
        toast.success('Settings saved successfully!', {
          description: 'Your changes will take effect on the next restart.',
        });
        queryClient.invalidateQueries({ queryKey: ['settings.get'] });
      },
      onError: (error: any) => {
        toast.error('Failed to save settings', {
          description: error.message || 'An unknown error occurred',
        });
      },
    }),
  );

  const autoResizeTextarea = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Preserve the document scroll position
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;

      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;

      // Restore the scroll position after layout recalculation
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollTop);
      });
    }
  };

  useEffect(() => {
    if (settingsData?.config) {
      setJsonValue(JSON.stringify(settingsData.config, null, 2));
    }
  }, [settingsData]);

  useEffect(() => {
    autoResizeTextarea();
  }, [jsonValue]);

  const validateJson = (value: string) => {
    try {
      JSON.parse(value);
      setIsValid(true);
      setParseError('');
      return true;
    } catch (error) {
      setIsValid(false);
      setParseError(error instanceof Error ? error.message : 'Invalid JSON');
      return false;
    }
  };

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    validateJson(value);
    setTimeout(autoResizeTextarea, 0); // Defer to next tick
  };

  const handleSave = () => {
    if (!isValid) {
      toast.error('Cannot save invalid JSON');
      return;
    }

    try {
      const parsedConfig = JSON.parse(jsonValue);
      saveMutation.mutate(parsedConfig);
    } catch (error) {
      toast.error('Failed to parse JSON');
    }
  };

  const handleReset = () => {
    if (settingsData?.config) {
      setJsonValue(JSON.stringify(settingsData.config, null, 2));
      setIsValid(true);
      setParseError('');
      setTimeout(autoResizeTextarea, 0);
    }
  };

  if (isLoading) {
    return (
      <Page breadcrumbs={['Diagnostics', 'Debug']}>
        <div className="flex items-center justify-center p-8">
          <div>Loading settings...</div>
        </div>
      </Page>
    );
  }

  const actions = (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={handleReset}
        disabled={saveMutation.isPending}
      >
        Reset
      </Button>
      <Button
        onClick={handleSave}
        disabled={!isValid || saveMutation.isPending}
      >
        {saveMutation.isPending ? 'Saving...' : 'Save'}
      </Button>
    </div>
  );

  return (
    <Page breadcrumbs={['Diagnostics', 'Debug']} actions={actions}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Debug Settings</h1>
          <p className="text-muted-foreground">
            Raw JSON editor for debugging configuration issues
          </p>
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            className={`min-h-96 w-full resize-none overflow-hidden rounded-md border p-3 font-mono text-sm ${
              isValid
                ? 'border-gray-300 dark:border-gray-600'
                : 'border-red-500 dark:border-red-400'
            } bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100`}
            spellCheck={false}
            placeholder="Loading settings..."
          />
        </div>

        {!isValid && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <strong>JSON Error:</strong> {parseError}
          </div>
        )}
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/settings/debug')({
  component: DebugSettings,
});
