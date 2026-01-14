/**
 * Setup Wizard Module
 *
 * Components for the initial server configuration wizard:
 * - WizardStep/WizardSteps: Step indicators with progress tracking
 * - ServerForm: Server connection configuration form
 * - VEEAM_DEFAULT_PORTS: Default port configuration for each product
 * - getProductPlaceholderUrl: Helper to get placeholder URL for a product
 * - getProductPortHelpText: Helper to get help text with port info
 *
 * Used during first-time setup to configure VBR, VRO, VBM, VONE, and K10 servers.
 *
 * @module components/setup-wizard
 */

export { WizardStep, WizardSteps } from './wizard-step';
export { 
  ServerForm, 
  VEEAM_DEFAULT_PORTS, 
  getProductPlaceholderUrl, 
  getProductPortHelpText 
} from './server-form';
export type { WizardStepProps, WizardStepsProps } from './wizard-step';
export type { ServerConfig, ServerFormProps } from './server-form';
