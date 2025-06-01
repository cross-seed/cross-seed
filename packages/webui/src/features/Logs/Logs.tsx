import { useState, useEffect, useRef } from 'react';
import { useTRPC } from '@/lib/trpc';
import { useSubscription } from '@trpc/tanstack-react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface LogEntry {
  timestamp: string;
  level: string;
  label: string;
  message: string;
}

export function Logs() {
  const [logLevel, setLogLevel] = useState<
    'error' | 'warn' | 'info' | 'verbose' | 'debug'
  >('info');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const trpc = useTRPC();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Real-time log subscription - always active
  const subscription = useSubscription(
    trpc.logs.subscribe.subscriptionOptions(
      { level: logLevel },
      {
        enabled: true,
        onData: (newLog) => {
          setLogs((prev) => {
            const updated = [...prev, newLog];
            // Keep only last 500 logs to prevent memory issues
            return updated.slice(-500);
          });
        },
        onError: (err) => {
          console.error('Log subscription error:', err);
        },
      },
    ),
  );

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && tableContainerRef.current) {
      // Find the ScrollArea's viewport
      const viewport = tableContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [logs, autoScroll]);

  // Reset logs when log level changes
  useEffect(() => {
    setLogs([]);
  }, [logLevel]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
          <Badge variant="outline" className="flex items-center gap-1.5">
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
            Live
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="log-level" className="text-sm font-medium">
              Level
            </Label>
            <Select value={logLevel} onValueChange={(value) => setLogLevel(value as any)}>
              <SelectTrigger id="log-level" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="verbose">Verbose</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="auto-scroll"
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
            />
            <Label htmlFor="auto-scroll" className="text-sm font-medium">
              Auto-scroll
            </Label>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {logs.length > 0 ? (
            <ScrollArea className="h-[600px]" ref={tableContainerRef}>
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-48">Time</TableHead>
                    <TableHead className="w-24">Level</TableHead>
                    <TableHead className="w-32">Label</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log, index) => (
                    <TableRow
                      key={`${log.timestamp}-${index}`}
                      className="hover:bg-muted/50"
                    >
                      <TableCell className="font-mono text-xs">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.level === 'error'
                              ? 'destructive'
                              : log.level === 'warn'
                              ? 'secondary'
                              : log.level === 'info'
                              ? 'default'
                              : log.level === 'debug'
                              ? 'outline'
                              : 'secondary'
                          }
                          className={
                            log.level === 'warn'
                              ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
                              : log.level === 'verbose'
                              ? 'bg-purple-100 text-purple-800 hover:bg-purple-100'
                              : ''
                          }
                        >
                          {log.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Badge variant="outline" className="font-mono text-xs">
                          {log.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm max-w-0">
                        <div className="truncate" title={log.message}>
                          {log.message}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
                <span className="text-sm font-medium">Waiting for logs...</span>
              </div>
              <p className="text-xs">
                Filtering by <Badge variant="outline">{logLevel}</Badge> level
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
