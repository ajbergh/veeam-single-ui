/**
 * Wizard Step Components
 *
 * Step indicator components for the setup wizard:
 * - WizardStep: Individual step indicator
 * - WizardSteps: Container for step sequence
 *
 * Features:
 * - Visual step number with completion state
 * - Active step highlighting
 * - Loading spinner for in-progress steps
 * - Checkmark for completed steps
 * - Step title and optional description
 *
 * States:
 * - Not reached: Muted styling
 * - Active: Primary border, highlighted
 * - Loading: Spinner icon
 * - Completed: Green checkmark
 *
 * Props (WizardStep):
 * - step: Step number (1-indexed)
 * - title: Step label
 * - description: Optional help text
 * - currentStep: Current active step
 * - isCompleted: Whether step is complete
 * - isLoading: Whether step is in progress
 *
 * @module components/setup-wizard/wizard-step
 */

'use client';

import { cn } from '@/lib/utils';
import { Check, Loader2 } from 'lucide-react';

export interface WizardStepProps {
  step: number;
  title: string;
  description?: string;
  currentStep: number;
  isCompleted?: boolean;
  isLoading?: boolean;
}

export function WizardStep({
  step,
  title,
  description,
  currentStep,
  isCompleted = false,
  isLoading = false,
}: WizardStepProps) {
  const isActive = step === currentStep;
  const isPast = step < currentStep;

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
          isCompleted || isPast
            ? 'border-primary bg-primary text-primary-foreground'
            : isActive
            ? 'border-primary bg-background text-primary'
            : 'border-muted bg-background text-muted-foreground'
        )}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isCompleted || isPast ? (
          <Check className="h-5 w-5" />
        ) : (
          <span className="text-sm font-medium">{step}</span>
        )}
      </div>
      <div className="flex flex-col">
        <span
          className={cn(
            'text-sm font-medium',
            isActive ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {title}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
    </div>
  );
}

export interface WizardStepsProps {
  steps: Array<{
    title: string;
    description?: string;
    isCompleted?: boolean;
  }>;
  currentStep: number;
  loadingStep?: number;
  orientation?: 'horizontal' | 'vertical';
}

export function WizardSteps({
  steps,
  currentStep,
  loadingStep,
  orientation = 'vertical',
}: WizardStepsProps) {
  return (
    <div
      className={cn(
        'flex gap-4',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col'
      )}
    >
      {steps.map((step, index) => (
        <div key={index} className="flex items-center gap-2">
          <WizardStep
            step={index + 1}
            title={step.title}
            description={step.description}
            currentStep={currentStep}
            isCompleted={step.isCompleted}
            isLoading={loadingStep === index + 1}
          />
          {orientation === 'horizontal' && index < steps.length - 1 && (
            <div className="h-px w-8 bg-muted" />
          )}
          {orientation === 'vertical' && index < steps.length - 1 && (
            <div className="ml-5 h-8 w-px bg-muted" />
          )}
        </div>
      ))}
    </div>
  );
}
