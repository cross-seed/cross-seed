import { useState } from "react";
import { useTRPC } from "@/lib/trpc";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface LogEntry {
  timestamp: string;
  level: string;
  label: string;
  message: string;
}

export function Logs() {
  const [logLevel, setLogLevel] = useState<"error" | "warn" | "info" | "verbose" | "debug">("info");
  const [limit, setLimit] = useState<number>(100);
  const trpc = useTRPC();

  const { data: logs, refetch, isLoading } = useSuspenseQuery(
    trpc.logs.getRecentLogs.queryOptions({
      input: { level: logLevel, limit }
    })
  );

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Logs</CardTitle>
          <div className="flex items-center gap-4">
            <select
              className="form-select rounded-md border border-gray-300 px-3 py-1 text-sm"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
            >
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
              <option value="verbose">Verbose</option>
            </select>
            <select
              className="form-select rounded-md border border-gray-300 px-3 py-1 text-sm"
              value={limit.toString()}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value="50">50 entries</option>
              <option value="100">100 entries</option>
              <option value="200">200 entries</option>
              <option value="500">500 entries</option>
            </select>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()} 
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-10">Loading logs...</div>
          ) : logs && logs.length > 0 ? (
            <div className="overflow-auto max-h-[600px] border rounded-md">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">Time</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">Level</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">Label</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">Message</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-2 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="px-6 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${
                          log.level === 'error' ? 'bg-red-100 text-red-800' :
                          log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                          log.level === 'info' ? 'bg-blue-100 text-blue-800' :
                          log.level === 'debug' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap">{log.label}</td>
                      <td className="px-6 py-2 font-mono text-sm break-all">{log.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              No logs available. Adjust filters or refresh to see logs.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}