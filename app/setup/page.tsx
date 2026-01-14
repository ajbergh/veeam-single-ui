/**
 * Setup Wizard Page
 *
 * Initial configuration wizard for connecting Veeam servers:
 * - Step 1: VBR Server (required)
 * - Step 2: VRO Server (optional)
 * - Step 3: VBM Server (optional)
 * - Step 4: Completion summary
 *
 * Features:
 * - Step-by-step wizard with progress indicator
 * - Connection testing with response time measurement
 * - Skip functionality for optional products
 * - Automatic redirect to dashboard on completion
 * - Error handling and retry options
 *
 * Uses Go backend for:
 * - Storing server credentials securely (AES-256-GCM)
 * - Testing API connectivity
 * - Managing server configuration
 *
 * @module app/setup/page
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSetupWizard } from '@/hooks/use-go-backend';
import { WizardSteps } from '@/components/setup-wizard/wizard-step';
import { ServerForm, ServerConfig } from '@/components/setup-wizard/server-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Server, 
  Shield, 
  Cloud,  
  CheckCircle, 
  ArrowRight,
  Loader2,
  AlertTriangle,
  PartyPopper
} from 'lucide-react';

const WIZARD_STEPS = [
  {
    title: 'VBR Server',
    description: 'Primary backup server (required)',
  },
  {
    title: 'VRO Server',
    description: 'Recovery Orchestrator (optional)',
  },
  {
    title: 'VBM Server',
    description: 'Microsoft 365 Backup (optional)',
  },
  {
    title: 'Complete',
    description: 'Finish setup',
  },
];

export default function SetupWizardPage() {
  const router = useRouter();
  const { setupStatus, isLoading, error, testConnection, processStep, completeSetup, refresh } = useSetupWizard();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loadingStep, setLoadingStep] = useState<number | undefined>();
  const [wizardError, setWizardError] = useState<string | null>(null);

  // If setup is already complete, redirect to dashboard
  useEffect(() => {
    if (!isLoading && setupStatus?.setupComplete) {
      router.push('/');
    }
  }, [isLoading, setupStatus, router]);

  const handleTestConnection = async (productType: string, config: ServerConfig) => {
    try {
      const result = await testConnection(
        productType,
        config.apiUrl,
        config.username,
        config.password,
        config.verifySSL
      );
      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
        responseTimeMs: 0,
      };
    }
  };

  const handleSaveStep = async (step: number, config: ServerConfig, productType: string) => {
    setLoadingStep(step);
    setWizardError(null);

    try {
      const input: {
        step: number;
        vbrServer?: typeof config & { testConnect: boolean };
        vroServer?: typeof config & { testConnect: boolean };
        vbmServer?: typeof config & { testConnect: boolean };
        k10Server?: typeof config & { testConnect: boolean };
      } = { step };

      const serverConfig = { ...config, testConnect: true };

      switch (productType) {
        case 'vbr':
          input.vbrServer = serverConfig;
          break;
        case 'vro':
          input.vroServer = serverConfig;
          break;
        case 'vbm':
          input.vbmServer = serverConfig;
          break;
        case 'k10':
          input.k10Server = serverConfig;
          break;
      }

      const result = await processStep(input);

      if (result.success) {
        setCompletedSteps(prev => [...prev, step]);
        setCurrentStep(step + 1);
      } else {
        setWizardError(result.message || 'Failed to save configuration');
      }
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setLoadingStep(undefined);
    }
  };

  const handleSkipStep = (step: number) => {
    setCurrentStep(step + 1);
  };

  const handleComplete = async () => {
    setLoadingStep(4);
    setWizardError(null);

    try {
      const result = await completeSetup();
      if (result.success) {
        setCompletedSteps(prev => [...prev, 4]);
        // Small delay before redirect
        setTimeout(() => {
          router.push('/');
        }, 1500);
      } else {
        setWizardError(result.message || 'Failed to complete setup');
      }
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to complete setup');
    } finally {
      setLoadingStep(undefined);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Checking setup status...</p>
        </div>
      </div>
    );
  }

  if (error && !setupStatus) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Setup Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Make sure the Go backend is running and accessible.
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => refresh()}>Retry</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const stepsWithCompletion = WIZARD_STEPS.map((step, index) => ({
    ...step,
    isCompleted: completedSteps.includes(index + 1),
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Veeam Single-UI</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Let&apos;s configure your Veeam server connections
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          {/* Sidebar with steps */}
          <aside className="hidden lg:block">
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle className="text-base">Setup Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <WizardSteps
                  steps={stepsWithCompletion}
                  currentStep={currentStep}
                  loadingStep={loadingStep}
                />
              </CardContent>
            </Card>
          </aside>

          {/* Main content */}
          <main className="space-y-6">
            {wizardError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{wizardError}</AlertDescription>
              </Alert>
            )}

            {/* Step 1: VBR Server */}
            {currentStep === 1 && (
              <ServerForm
                productType="vbr"
                title="Veeam Backup & Replication"
                description="Connect to your primary VBR server. This is required to use the application."
                icon={<Server className="h-6 w-6 text-primary" />}
                required
                onTest={config => handleTestConnection('vbr', config)}
                onSave={config => handleSaveStep(1, config, 'vbr')}
                isLoading={loadingStep === 1}
                defaultValues={{
                  name: 'Production VBR Server',
                  apiUrl: '',
                  verifySSL: false,
                }}
              />
            )}

            {/* Step 2: VRO Server */}
            {currentStep === 2 && (
              <ServerForm
                productType="vro"
                title="Veeam Recovery Orchestrator"
                description="Connect to VRO for disaster recovery orchestration and automated failover."
                icon={<Shield className="h-6 w-6 text-primary" />}
                onTest={config => handleTestConnection('vro', config)}
                onSkip={() => handleSkipStep(2)}
                onSave={config => handleSaveStep(2, config, 'vro')}
                isLoading={loadingStep === 2}
                defaultValues={{
                  name: 'VRO Server',
                  apiUrl: '',
                  verifySSL: false,
                }}
              />
            )}

            {/* Step 3: VBM Server */}
            {currentStep === 3 && (
              <ServerForm
                productType="vbm"
                title="Veeam Backup for Microsoft 365"
                description="Connect to VBM for Microsoft 365 data protection including Exchange, SharePoint, and Teams."
                icon={<Cloud className="h-6 w-6 text-primary" />}
                onTest={config => handleTestConnection('vbm', config)}
                onSkip={() => handleSkipStep(3)}
                onSave={config => handleSaveStep(3, config, 'vbm')}
                isLoading={loadingStep === 3}
                defaultValues={{
                  name: 'VBM Server',
                  apiUrl: '',
                  verifySSL: false,
                }}
              />
            )}

            {/* Step 4: Complete */}
            {currentStep === 4 && (
              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <PartyPopper className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <CardTitle className="text-2xl">Setup Complete!</CardTitle>
                  <CardDescription className="text-base">
                    Your Veeam server connections have been configured successfully.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mx-auto max-w-md space-y-4">
                    <div className="rounded-lg bg-muted/50 p-4">
                      <h4 className="mb-2 font-medium">Configured Servers:</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {completedSteps.includes(1) && (
                          <li className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            Veeam Backup & Replication
                          </li>
                        )}
                        {completedSteps.includes(2) && (
                          <li className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            Veeam Recovery Orchestrator
                          </li>
                        )}
                        {completedSteps.includes(3) && (
                          <li className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            Veeam Backup for Microsoft 365
                          </li>
                        )}
                      </ul>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      You can add or modify server connections later in Administration → Servers.
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="justify-center">
                  <Button size="lg" onClick={handleComplete} disabled={loadingStep === 4}>
                    {loadingStep === 4 ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Finishing...
                      </>
                    ) : (
                      <>
                        Go to Dashboard
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
