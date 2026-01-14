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
import { Badge } from '@/components/ui/badge';
import { 
  Server, 
  Shield, 
  Cloud,
  BarChart,
  CheckCircle, 
  ArrowRight,
  Loader2,
  AlertTriangle,
  PartyPopper,
  Sparkles,
  Rocket,
  Database,
  Lock
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
    title: 'Veeam ONE',
    description: 'Analytics & Monitoring (optional)',
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
        voneServer?: typeof config & { testConnect: boolean };
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
        case 'vone':
          input.voneServer = serverConfig;
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
    setLoadingStep(5);
    setWizardError(null);

    try {
      const result = await completeSetup();
      if (result.success) {
        setCompletedSteps(prev => [...prev, 5]);
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <div className="flex flex-col items-center gap-6 p-8">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium text-foreground">Initializing Setup</p>
            <p className="text-sm text-muted-foreground">Checking system configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !setupStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
        <Card className="max-w-md border-0 shadow-2xl">
          <div className="h-1.5 bg-gradient-to-r from-destructive to-destructive/60 rounded-t-lg" />
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-xl">Setup Error</CardTitle>
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Decorative Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto py-8 px-4 max-w-6xl">
        {/* Enhanced Header */}
        <div className="mb-10 text-center space-y-4">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30">
                <Rocket className="h-8 w-8" />
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Welcome to Veeam Single-UI
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Let&apos;s connect your Veeam infrastructure. Configure your servers below to get started.
          </p>
          
          {/* Feature badges */}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Badge variant="secondary" className="gap-1.5 px-3 py-1">
              <Lock className="h-3 w-3" />
              Encrypted Storage
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1">
              <Database className="h-3 w-3" />
              Multi-Server Support
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1">
              <Sparkles className="h-3 w-3" />
              Smart Defaults
            </Badge>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
          {/* Enhanced Sidebar with steps */}
          <aside className="hidden lg:block">
            <Card className="sticky top-8 border-0 shadow-xl bg-gradient-to-b from-card to-card/95 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Setup Progress
                </CardTitle>
                <CardDescription>
                  {currentStep <= 4 
                    ? `Step ${currentStep} of ${WIZARD_STEPS.length - 1}`
                    : 'Almost there!'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-6">
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
            {/* Mobile Step Indicator */}
            <div className="lg:hidden">
              <Card className="border-0 shadow-md bg-gradient-to-r from-primary/5 to-transparent">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                        {currentStep}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{WIZARD_STEPS[currentStep - 1]?.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Step {currentStep} of {WIZARD_STEPS.length - 1}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {WIZARD_STEPS.slice(0, -1).map((_, index) => (
                        <div
                          key={index}
                          className={`h-1.5 w-6 rounded-full transition-colors duration-300 ${
                            index + 1 <= currentStep 
                              ? completedSteps.includes(index + 1) 
                                ? 'bg-green-500' 
                                : 'bg-primary'
                              : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {wizardError && (
              <Alert variant="destructive" className="animate-in slide-in-from-top-2 duration-300 border-0 shadow-lg">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Configuration Error</AlertTitle>
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

            {/* Step 4: Veeam ONE */}
            {currentStep === 4 && (
              <ServerForm
                productType="vone"
                title="Veeam ONE"
                description="Connect to Veeam ONE for analytics, monitoring, and reporting across your backup infrastructure."
                icon={<BarChart className="h-6 w-6 text-primary" />}
                onTest={config => handleTestConnection('vone', config)}
                onSkip={() => handleSkipStep(4)}
                onSave={config => handleSaveStep(4, config, 'vone')}
                isLoading={loadingStep === 4}
                defaultValues={{
                  name: 'Veeam ONE Server',
                  apiUrl: '',
                  verifySSL: false,
                }}
              />
            )}

            {/* Step 5: Complete */}
            {currentStep === 5 && (
              <Card className="text-center border-0 shadow-2xl overflow-hidden">
                {/* Decorative gradient header */}
                <div className="h-32 bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 relative">
                  <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRoLTJ2LTRoMnYtMmgtMnYtMmgydi0yaC0ydi0yaDJ2LTJoLTJ2LTJoMnYtMmgtMlY2aDJ2MmgtMnYyaDJ2MmgtMnYyaDJ2MmgtMnYyaDJ2MmgtMnYyaDJ2MmgtMnYyaDJ2Mmgtdjhfemg0djJoLTR2LTJoLTJ2Mmg0djJ6bS0xMi0yMHY0aC00di00aDR6bTQtMTZ2NGgtNFY0aDR6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-white/30 blur-xl animate-pulse" />
                      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-xl">
                        <PartyPopper className="h-10 w-10 text-green-600" />
                      </div>
                    </div>
                  </div>
                </div>
                
                <CardHeader className="pt-8">
                  <CardTitle className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                    Setup Complete!
                  </CardTitle>
                  <CardDescription className="text-base mt-2">
                    Your Veeam infrastructure is now connected and ready to use.
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="pb-8">
                  <div className="mx-auto max-w-md space-y-6">
                    {/* Configured Servers Summary */}
                    <div className="rounded-xl bg-gradient-to-br from-muted/50 to-muted/30 p-6 border border-muted-foreground/10">
                      <h4 className="mb-4 font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                        Connected Servers
                      </h4>
                      <ul className="space-y-3">
                        {completedSteps.includes(1) && (
                          <li className="flex items-center gap-3 text-sm animate-in slide-in-from-left duration-300">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                            <div className="flex-1 text-left">
                              <span className="font-medium">Veeam Backup & Replication</span>
                              <p className="text-xs text-muted-foreground">Primary backup server</p>
                            </div>
                          </li>
                        )}
                        {completedSteps.includes(2) && (
                          <li className="flex items-center gap-3 text-sm animate-in slide-in-from-left duration-300 delay-100">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                            <div className="flex-1 text-left">
                              <span className="font-medium">Veeam Recovery Orchestrator</span>
                              <p className="text-xs text-muted-foreground">DR orchestration</p>
                            </div>
                          </li>
                        )}
                        {completedSteps.includes(3) && (
                          <li className="flex items-center gap-3 text-sm animate-in slide-in-from-left duration-300 delay-200">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                            <div className="flex-1 text-left">
                              <span className="font-medium">Veeam Backup for Microsoft 365</span>
                              <p className="text-xs text-muted-foreground">M365 data protection</p>
                            </div>
                          </li>
                        )}
                        {completedSteps.includes(4) && (
                          <li className="flex items-center gap-3 text-sm animate-in slide-in-from-left duration-300 delay-300">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                            <div className="flex-1 text-left">
                              <span className="font-medium">Veeam ONE</span>
                              <p className="text-xs text-muted-foreground">Analytics & monitoring</p>
                            </div>
                          </li>
                        )}
                      </ul>
                    </div>
                    
                    <p className="text-sm text-muted-foreground">
                      You can manage server connections anytime in{' '}
                      <span className="font-medium text-foreground">Administration → Servers</span>
                    </p>
                  </div>
                </CardContent>
                
                <CardFooter className="justify-center pb-8">
                  <Button 
                    size="lg" 
                    onClick={handleComplete} 
                    disabled={loadingStep === 5}
                    className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 shadow-lg shadow-green-500/25 px-8 text-base"
                  >
                    {loadingStep === 5 ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Finishing Setup...
                      </>
                    ) : (
                      <>
                        <Rocket className="h-5 w-5" />
                        Launch Dashboard
                        <ArrowRight className="h-5 w-5" />
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
