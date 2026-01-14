/**
 * Server Form Component
 *
 * Reusable form for configuring Veeam product server connections:
 * - VBR, VRO, VBM, K10 server configuration
 * - Connection testing with response time measurement
 * - Credential storage via Go backend
 *
 * Features:
 * - Server URL, username, password inputs
 * - SSL verification toggle
 * - Test connection button with status feedback
 * - Skip option for optional products
 * - Loading states during operations
 * - Success/failure icons and messages
 *
 * Props:
 * - productType: 'vbr' | 'vro' | 'vbm' | 'k10'
 * - title: Product display name
 * - description: Setup help text
 * - icon: Product icon component
 * - required: Whether this product must be configured
 * - onTest: Async function to test connection
 * - onSkip: Callback when user skips configuration
 * - onSave: Async function to save configuration
 * - defaultValues: Pre-filled form values
 * - isLoading: External loading state
 *
 * @module components/setup-wizard/server-form
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CheckCircle, XCircle, Zap } from 'lucide-react';

export interface ServerConfig {
  name: string;
  apiUrl: string;
  username: string;
  password: string;
  verifySSL: boolean;
}

export interface ServerFormProps {
  productType: 'vbr' | 'vro' | 'vbm' | 'k10';
  title: string;
  description: string;
  icon: React.ReactNode;
  required?: boolean;
  onTest?: (config: ServerConfig) => Promise<{ success: boolean; message: string; responseTimeMs?: number }>;
  onSkip?: () => void;
  onSave: (config: ServerConfig) => Promise<void>;
  defaultValues?: Partial<ServerConfig>;
  isLoading?: boolean;
}

export function ServerForm({
  productType,
  title,
  description,
  icon,
  required = false,
  onTest,
  onSkip,
  onSave,
  defaultValues,
  isLoading = false,
}: ServerFormProps) {
  const [config, setConfig] = useState<ServerConfig>({
    name: defaultValues?.name || `${productType.toUpperCase()} Server`,
    apiUrl: defaultValues?.apiUrl || '',
    username: defaultValues?.username || '',
    password: defaultValues?.password || '',
    verifySSL: defaultValues?.verifySSL ?? false,
  });

  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    responseTimeMs?: number;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (field: keyof ServerConfig, value: string | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
    setError(null);
  };

  const handleTest = async () => {
    if (!onTest) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await onTest(config);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!config.apiUrl || !config.username || !config.password) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = config.apiUrl && config.username && config.password;

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <div className="flex-1">
          <CardTitle className="flex items-center gap-2">
            {title}
            {required && (
              <span className="text-xs font-normal text-red-500">(Required)</span>
            )}
            {!required && (
              <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
            )}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${productType}-name`}>Server Name</Label>
            <Input
              id={`${productType}-name`}
              placeholder="e.g., Production VBR"
              value={config.name}
              onChange={e => handleInputChange('name', e.target.value)}
              disabled={isLoading || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${productType}-url`}>API URL *</Label>
            <Input
              id={`${productType}-url`}
              placeholder={`https://${productType}-server.example.com:9419`}
              value={config.apiUrl}
              onChange={e => handleInputChange('apiUrl', e.target.value)}
              disabled={isLoading || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${productType}-username`}>Username *</Label>
            <Input
              id={`${productType}-username`}
              placeholder="username or DOMAIN\\username"
              value={config.username}
              onChange={e => handleInputChange('username', e.target.value)}
              disabled={isLoading || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${productType}-password`}>Password *</Label>
            <Input
              id={`${productType}-password`}
              type="password"
              placeholder="Enter password"
              value={config.password}
              onChange={e => handleInputChange('password', e.target.value)}
              disabled={isLoading || isSaving}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${productType}-ssl`}
            checked={config.verifySSL}
            onCheckedChange={checked => handleInputChange('verifySSL', !!checked)}
            disabled={isLoading || isSaving}
          />
          <Label htmlFor={`${productType}-ssl`} className="text-sm font-normal">
            Verify SSL Certificate (disable for self-signed certs in lab environments)
          </Label>
        </div>

        {testResult && (
          <Alert variant={testResult.success ? 'default' : 'destructive'}>
            <div className="flex items-center gap-2">
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription className="flex-1">
                {testResult.message}
                {testResult.responseTimeMs && (
                  <span className="ml-2 text-muted-foreground">
                    ({testResult.responseTimeMs}ms)
                  </span>
                )}
              </AlertDescription>
            </div>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between pt-4">
          <div className="flex gap-2">
            {onTest && (
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!canSave || isTesting || isSaving}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Test Connection
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!required && onSkip && (
              <Button variant="ghost" onClick={onSkip} disabled={isSaving}>
                Skip
              </Button>
            )}
            <Button onClick={handleSave} disabled={!canSave || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save & Continue'
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
