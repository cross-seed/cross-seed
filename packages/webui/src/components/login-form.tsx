import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTRPC } from '@/lib/trpc';
import {
  useMutation,
  useSuspenseQuery,
  useQueryClient,
} from '@tanstack/react-query';

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const trpc = useTRPC();

  const { data: authStatus } = useSuspenseQuery(
    trpc.auth.authStatus.queryOptions(),
  );

  const { mutate: login, isPending } = useMutation(
    trpc.auth.logIn.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.auth.authStatus.queryKey(),
        });
      },
      onError: (error) => {
        const message =
          error?.data?.code === 'UNAUTHORIZED'
            ? 'Invalid username or password'
            : error?.message ?? 'Login failed';
        setError(message);
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    login({ username, password });
  };

  const isSignUp = !authStatus.userExists;
  const signupAllowed = authStatus.signupAllowed;
  const isDocker = authStatus.isDocker;
  const resetCommand = isDocker
    ? 'docker exec -it <container> cross-seed reset-user'
    : 'cross-seed reset-user';

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>
            {isSignUp ? 'Initial Setup' : 'Login to your account'}
          </CardTitle>
          <CardDescription>
            {isSignUp
              ? 'Create a user'
              : 'Enter your username and password to access your account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              {isSignUp && signupAllowed && (
                <p className="text-muted-foreground text-sm">
                  For security reasons, initial setup is only available for 5
                  minutes after cross-seed starts.
                </p>
              )}
              {isSignUp && !signupAllowed && (
                <p className="text-destructive text-sm font-medium">
                  Setup window closed for security reasons. Restart cross-seed
                  to create the first user.
                </p>
              )}
              {error && (
                <div className="text-destructive text-sm font-medium">
                  {error}
                </div>
              )}
              <div className="grid gap-3">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isPending || (isSignUp && !signupAllowed)}
                  required
                />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isPending || (isSignUp && !signupAllowed)}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isPending || (isSignUp && !signupAllowed)}
                className="w-full"
              >
                {isPending
                  ? 'Processing...'
                  : isSignUp
                    ? 'Create Account'
                    : 'Login'}
              </Button>
              {!isSignUp && (
                <p className="text-muted-foreground text-sm">
                  Forgot password? Run{' '}
                  <code>{resetCommand}</code>{' '}
                  .
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
