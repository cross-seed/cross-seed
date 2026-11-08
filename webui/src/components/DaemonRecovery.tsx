import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

/** Remains inside authentication, including when stored settings aren't usable. */
export function DaemonRecovery({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const { data: recovery, isPending } = useQuery(
    trpc.settings.recovery.queryOptions(undefined, {
      refetchInterval: (query) => (query.state.data ? 2000 : false),
    }),
  );
  const [json, setJson] = useState("");
  const [parseError, setParseError] = useState("");
  useEffect(() => {
    if (recovery?.rawSettings != null) setJson(recovery.rawSettings);
  }, [recovery?.rawSettings]);
  const repair = useMutation(
    trpc.settings.replace.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
      },
    }),
  );
  if (isPending) return <p className="p-6">Loading daemon status…</p>;
  if (!recovery) return children;
  const isSettings = pathname.startsWith("/settings");
  const isDiagnostics = pathname === "/settings/health" || pathname === "/logs";
  return (
    <>
      <div
        role="alert"
        className="shrink-0 border-b border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      >
        <h2 className="font-semibold">
          Cross-seed is paused until its settings are repaired
        </h2>
        <p className="text-sm">
          The Web UI is available. Searches, indexing, and injection are paused.
          Your stored settings have not been reset.
        </p>
        <p className="mt-2 text-sm whitespace-pre-wrap">{recovery.message}</p>
        {recovery.source === "file" ? (
          <p className="mt-2 text-sm">
            Fix config.js and restart cross-seed to retry the complete import,
            including your indexers. The original file has been preserved.
          </p>
        ) : (
          <p className="mt-2 text-sm">
            Save valid settings to resume automatically. Changes to the HTTP
            address, port, or URL prefix require a restart.
          </p>
        )}
      </div>
      {isDiagnostics ? (
        children
      ) : recovery.source === "file" ? (
        <div className="p-6">
          Logs and Health remain available from the sidebar.
        </div>
      ) : recovery.useJsonEditor ? (
        <div className="min-h-0 space-y-3 overflow-auto p-6">
          <h1 className="text-xl font-semibold">Repair stored settings</h1>
          <p>
            Correct the saved JSON below. Saving replaces settings only;
            indexers, users, and history are preserved. Include your existing
            API key to retain it.
          </p>
          <label htmlFor="recovery-settings" className="block font-medium">
            Stored settings JSON (includes secrets)
          </label>
          <textarea
            id="recovery-settings"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            className="min-h-72 w-full rounded border p-3 font-mono text-sm"
            spellCheck={false}
          />
          {(parseError || repair.error) && (
            <p role="alert">{parseError || repair.error?.message}</p>
          )}
          <Button
            disabled={repair.isPending}
            onClick={() => {
              try {
                const value: unknown = JSON.parse(json);
                if (!value || typeof value !== "object" || Array.isArray(value))
                  throw new Error("Settings must be a JSON object.");
                setParseError("");
                repair.mutate(value as Record<string, unknown>);
              } catch (error) {
                setParseError(
                  error instanceof Error ? error.message : "Invalid JSON",
                );
              }
            }}
          >
            Save repaired settings
          </Button>
        </div>
      ) : isSettings ? (
        children
      ) : (
        <div className="p-6">
          <Link to="/settings/directories" className="underline">
            Open Settings to repair your configuration
          </Link>
        </div>
      )}
    </>
  );
}
