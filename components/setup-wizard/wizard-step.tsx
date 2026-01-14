/**
 * Wizard Step Components
 *
 * Step indicator components for the setup wizard:
 * - WizardStep: Individual step indicator with enhanced visuals
 * - WizardSteps: Container for step sequence with connecting lines
 *
 * Features:
 * - Animated step transitions with smooth color changes
 * - Visual step number with completion state
 * - Active step highlighting with glow effect
 * - Loading spinner with pulse animation for in-progress steps
 * - Animated checkmark for completed steps
 * - Step title and optional description with fade-in
 * - Connecting lines that animate on progress
 *
 * States:
 * - Not reached: Muted styling with subtle border
 * - Active: Primary color with subtle glow
 * - Loading: Animated spinner with pulse
 * - Completed: Green gradient with checkmark animation
 *
 * @module components/setup-wizard/wizard-step
 */

'use client';

import { cn } from '@/lib/utils';
import { Check, Loader2, Circle } from 'lucide-react';

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
    <div 
      className={cn(
        "flex items-center gap-4 transition-all duration-300 ease-out",
        isActive && "translate-x-1"
      )}
    >
      {/* Step Circle */}
      <div className="relative">
        {/* Glow effect for active step */}
        {isActive && (
          <div className="absolute inset-0 rounded-full bg-primary/30 blur-md animate-pulse" />
        )}
        <div
          className={cn(
            'relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all duration-300 ease-out',
            isCompleted || isPast
              ? 'border-green-500 bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25'
              : isActive
              ? 'border-primary bg-primary/10 text-primary shadow-lg shadow-primary/20'
              : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground'
          )}
        >
          {isLoading ? (
            <div className="relative">
              <Loader2 className="h-5 w-5 animate-spin" />
              <Circle className="absolute inset-0 h-5 w-5 animate-ping opacity-30" />
            </div>
          ) : isCompleted || isPast ? (
            <Check className="h-5 w-5 animate-in zoom-in-50 duration-300" strokeWidth={3} />
          ) : (
            <span className={cn(
              "text-sm font-bold transition-transform duration-200",
              isActive && "scale-110"
            )}>
              {step}
            </span>
          )}
        </div>
      </div>

      {/* Step Content */}
      <div className="flex flex-col">
        <span
          className={cn(
            'text-sm font-semibold transition-colors duration-200',
            isCompleted || isPast
              ? 'text-green-600 dark:text-green-500'
              : isActive 
              ? 'text-foreground' 
              : 'text-muted-foreground'
          )}
        >
          {title}
        </span>
        {description && (
          <span className={cn(
            "text-xs transition-colors duration-200",
            isActive ? "text-muted-foreground" : "text-muted-foreground/70"
          )}>
            {description}
          </span>
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
        'flex gap-0',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col'
      )}
    >
      {steps.map((step, index) => {
        const isCompleted = step.isCompleted || index + 1 < currentStep;
        const isActive = index + 1 === currentStep;
        
        return (
          <div key={index} className="flex items-stretch">
            <div className={cn(
              "flex",
              orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col'
            )}>
              <WizardStep
                step={index + 1}
                title={step.title}
                description={step.description}
                currentStep={currentStep}
                isCompleted={step.isCompleted}
                isLoading={loadingStep === index + 1}
              />
              
              {/* Connecting Line */}
              {index < steps.length - 1 && (
                <>
                  {orientation === 'horizontal' ? (
                    <div className="relative mx-4 h-0.5 w-12">
                      <div className="absolute inset-0 bg-muted-foreground/20 rounded-full" />
                      <div 
                        className={cn(
                          "absolute inset-y-0 left-0 bg-gradient-to-r from-green-500 to-green-600 rounded-full transition-all duration-500 ease-out",
                          isCompleted ? "w-full" : "w-0"
                        )} 
                      />
                    </div>
                  ) : (
                    <div className="relative ml-[21px] my-2 w-0.5 h-8">
                      <div className="absolute inset-0 bg-muted-foreground/20 rounded-full" />
                      <div 
                        className={cn(
                          "absolute inset-x-0 top-0 bg-gradient-to-b from-green-500 to-green-600 rounded-full transition-all duration-500 ease-out",
                          isCompleted ? "h-full" : "h-0"
                        )} 
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
