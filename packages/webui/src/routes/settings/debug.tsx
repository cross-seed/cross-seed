import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { SettingsLayout } from '@/components/SettingsLayout';
import { Page } from '@/components/Page';

function DebugSettings() {
  const [jsonValue, setJsonValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [parseError, setParseError] = useState('');

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: settingsData, isLoading } = useQuery(
    trpc.settings.get.queryOptions(undefined)
  );

  const saveMutation = useMutation({
    mutationFn: (config: any) => trpc.settings.save.mutate(config),
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
  });

  useEffect(() => {
    if (settingsData?.config) {
      setJsonValue(JSON.stringify(settingsData.config, null, 2));
    }
  }, [settingsData]);

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
    }
  };

  if (isLoading) {
    return (
      <Page>
        <SettingsLayout>
          <div className="flex items-center justify-center p-8">
            <div>Loading settings...</div>
          </div>
        </SettingsLayout>
      </Page>
    );
  }

  return (
    <Page>
      <SettingsLayout>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Raw Settings JSON</h3>
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
          </div>
          
          {!isValid && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              <strong>JSON Error:</strong> {parseError}
            </div>
          )}

          <div className="relative">
            <textarea
              value={jsonValue}
              onChange={(e) => handleJsonChange(e.target.value)}
              className={`w-full h-96 p-3 font-mono text-sm border rounded-md resize-none ${
                isValid 
                  ? 'border-gray-300 dark:border-gray-600' 
                  : 'border-red-500 dark:border-red-400'
              } bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100`}
              spellCheck={false}
              placeholder="Loading settings..."
            />
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p>
              <strong>Warning:</strong> This is a raw JSON editor for debugging purposes. 
              Invalid configuration may cause the application to malfunction. 
              Use the regular settings pages for safe configuration changes.
            </p>
          </div>
        </div>
      </SettingsLayout>
    </Page>
  );
}

export const Route = createFileRoute('/settings/debug')({
  component: DebugSettings,
});