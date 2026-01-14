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
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, Zap, Globe, User, Lock, Server, ShieldCheck, ArrowRight, SkipForward } from 'lucide-react';

/**
 * Default port numbers for each Veeam product REST API
 * - VBR: 9419 (Veeam Backup & Replication)
 * - VRO: 9898 (Veeam Recovery Orchestrator)
 * - VBM: 4443 (Veeam Backup for Microsoft 365)
 * - VONE: 1239 (Veeam ONE Web Services)
 * - K10: 8000 (Kasten K10 API Gateway, typically with /k10 path)
 */
export const VEEAM_DEFAULT_PORTS: Record<string, { port: number; apiPath?: string; exampleHost: string }> = {
  vbr: { port: 9419, exampleHost: 'vbr-server' },
  vro: { port: 9898, exampleHost: 'vro-server' },
  vbm: { port: 4443, exampleHost: 'vbm-server' },
  vone: { port: 1239, apiPath: '/api/v2.3', exampleHost: 'veeam-one-server' },
  k10: { port: 8000, apiPath: '/k10', exampleHost: 'k10-cluster' },
};

/**
 * Get placeholder URL for a product type
 */
export function getProductPlaceholderUrl(productType: string): string {
  const config = VEEAM_DEFAULT_PORTS[productType] || VEEAM_DEFAULT_PORTS.vbr;
  return `https://${config.exampleHost}:${config.port}`;
}

/**
 * Get help text with port information for a product type
 */
export function getProductPortHelpText(productType: string): string {
  const config = VEEAM_DEFAULT_PORTS[productType];
  if (!config) return '';
  return `Default port: ${config.port}${config.apiPath ? `, API path: ${config.apiPath}` : ''}`;
}

export interface ServerConfig {
  name: string;
  apiUrl: string;
  username: string;
  password: string;
  verifySSL: boolean;
}

export interface ServerFormProps {
  productType: 'vbr' | 'vro' | 'vbm' | 'vone' | 'k10';
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
    <Card className="w-full overflow-hidden border-0 shadow-xl bg-gradient-to-b from-card to-card/95">
      {/* Decorative header gradient */}
      <div className="h-1.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
      
      <CardHeader className="pb-4">
        <div className="flex items-start gap-5">
          {/* Enhanced Icon Container */}
          <div className="relative group">
            <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl group-hover:blur-2xl transition-all duration-300" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-inner">
              <div className="text-primary">
                {icon}
              </div>
            </div>
          </div>
          
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl font-bold tracking-tight">
                {title}
              </CardTitle>
              {required ? (
                <Badge variant="destructive" className="text-[10px] px-2 py-0 font-medium">
                  Required
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] px-2 py-0 font-medium">
                  Optional
                </Badge>
              )}
            </div>
            <CardDescription className="text-sm leading-relaxed">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6 pt-2">
        {/* Form Fields with Enhanced Styling */}
        <div className="space-y-5">
          {/* Server Name - Full Width */}
          <div className="space-y-2">
            <Label htmlFor={`${productType}-name`} className="text-sm font-medium flex items-center gap-2">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              Server Name
            </Label>
            <Input
              id={`${productType}-name`}
              placeholder="e.g., Production Server"
              value={config.name}
              onChange={e => handleInputChange('name', e.target.value)}
              disabled={isLoading || isSaving}
              className="h-11 bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all duration-200"
            />
          </div>

          {/* API URL - Full Width with Port Helper */}
          <div className="space-y-2">
            <Label htmlFor={`${productType}-url`} className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              API URL
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id={`${productType}-url`}
              placeholder={getProductPlaceholderUrl(productType)}
              value={config.apiUrl}
              onChange={e => handleInputChange('apiUrl', e.target.value)}
              disabled={isLoading || isSaving}
              className="h-11 font-mono text-sm bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all duration-200"
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
              {getProductPortHelpText(productType)}
            </p>
          </div>

          {/* Credentials Row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${productType}-username`} className="text-sm font-medium flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Username
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`${productType}-username`}
                placeholder="username or DOMAIN\\username"
                value={config.username}
                onChange={e => handleInputChange('username', e.target.value)}
                disabled={isLoading || isSaving}
                className="h-11 bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all duration-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${productType}-password`} className="text-sm font-medium flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                Password
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`${productType}-password`}
                type="password"
                placeholder="••••••••••••"
                value={config.password}
                onChange={e => handleInputChange('password', e.target.value)}
                disabled={isLoading || isSaving}
                className="h-11 bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all duration-200"
              />
            </div>
          </div>
        </div>

        {/* SSL Checkbox with Enhanced Styling */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-muted-foreground/10">
          <Checkbox
            id={`${productType}-ssl`}
            checked={config.verifySSL}
            onCheckedChange={checked => handleInputChange('verifySSL', !!checked)}
            disabled={isLoading || isSaving}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={`${productType}-ssl`} className="text-sm font-medium cursor-pointer flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              Verify SSL Certificate
            </Label>
            <span className="text-xs text-muted-foreground">
              Disable for self-signed certificates in lab or development environments
            </span>
          </div>
        </div>

        {/* Test Result with Enhanced Feedback */}
        {testResult && (
          <Alert 
            variant={testResult.success ? 'default' : 'destructive'}
            className={testResult.success 
              ? 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400' 
              : ''
            }
          >
            <div className="flex items-center gap-3">
              {testResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-500 animate-in zoom-in-50 duration-200" />
              ) : (
                <XCircle className="h-5 w-5 animate-in zoom-in-50 duration-200" />
              )}
              <AlertDescription className="flex-1 font-medium">
                {testResult.message}
                {testResult.responseTimeMs && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    Response time: {testResult.responseTimeMs}ms
                  </span>
                )}
              </AlertDescription>
            </div>
          </Alert>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive" className="animate-in slide-in-from-top-2 duration-200">
            <XCircle className="h-4 w-4" />
            <AlertDescription className="font-medium">{error}</AlertDescription>
          </Alert>
        )}

        {/* Action Buttons with Enhanced Styling */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 pt-4 border-t border-muted-foreground/10">
          <div className="flex gap-2">
            {onTest && (
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!canSave || isTesting || isSaving}
                className="gap-2 transition-all duration-200 hover:bg-primary/5 hover:border-primary/50"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Test Connection
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            {!required && onSkip && (
              <Button 
                variant="ghost" 
                onClick={onSkip} 
                disabled={isSaving}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <SkipForward className="h-4 w-4" />
                Skip
              </Button>
            )}
            <Button 
              onClick={handleSave} 
              disabled={!canSave || isSaving}
              className="gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg shadow-primary/25 transition-all duration-200"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Save & Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
