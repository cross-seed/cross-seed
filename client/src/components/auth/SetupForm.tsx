import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SetupFormProps {
  onSuccess?: () => void;
}

export function SetupForm({ onSuccess }: SetupFormProps) {
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      await setup(username, password);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during setup');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 py-2 pb-4">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Welcome to Cross-Seed</h2>
        <p className="text-sm text-muted-foreground">
          Create an admin account to get started.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="setup-username">
            Username
          </label>
          <Input
            id="setup-username"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="setup-password">
            Password
          </label>
          <Input
            id="setup-password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
          />
          <p className="text-xs text-muted-foreground">
            Password must be at least 8 characters.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" htmlFor="setup-confirm-password">
            Confirm Password
          </label>
          <Input
            id="setup-confirm-password"
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            required
          />
        </div>
        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Creating Account...' : 'Create Account'}
        </Button>
      </form>
    </div>
  );
}