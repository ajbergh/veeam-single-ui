/**
 * Veeam Backup & Replication API Client
 *
 * This is the central API client for the Veeam Single-UI frontend. It provides:
 * - Unified interface for all Veeam product APIs (VBR, VRO, VBM)
 * - Intelligent routing: Uses Go backend when available, falls back to Next.js API routes
 * - Token management: Handles authentication, refresh, and token injection
 * - Rate limiting: Respects API limits (especially VBM's 1 req/sec)
 * - Error handling: Graceful degradation for permission errors and missing endpoints
 *
 * Architecture:
 *   Component → veeam-client.ts → go-backend-client.ts → Go Backend → Veeam APIs
 *                     ↓ (fallback)
 *               Next.js API Routes → Veeam APIs
 *
 * Key Functions:
 * - getBackupJobs(): Fetches all backup jobs with state enrichment
 * - getSessions(): Fetches job sessions with filtering
 * - getRepositories(): Fetches backup repositories with capacity info
 * - getProtectedData(): Fetches protected workloads (VMs, files, etc.)
 * - getMalwareEvents(): Fetches malware detection events
 * - getSecurityBestPractices(): Fetches security analyzer results
 * - getVBMJobs(), getVBMSessions(): VBM-specific endpoints
 * - getVROPlans(): VRO recovery plan endpoints
 *
 * Error Handling:
 * - 403 errors: Logged as warnings, returns empty data (graceful degradation)
 * - 404 errors: Handles endpoint differences between VBR versions
 * - Network errors: Retries with exponential backoff via rate limiter
 *
 * @module lib/api/veeam-client
 */

import {
  VeeamBackupJob,
  VeeamSession,
  JobsResult,
  SessionsResult,
  VeeamApiError,
  ManagedServer,
  ManagedServersResult,
  RepositoryModel,
  RepositoriesResult,
  LicenseModel,
  MalwareEventModel,
  MalwareEventsResult,
  SecurityBestPracticeItem,
  SecurityBestPracticesResult,
  VeeamTaskSession,
  TaskSessionsResult,
  VRORecoveryPlan,
  PlansResult,
  VeeamBackup,
  VeeamBackupFile,
  BackupsResult,
  VeeamProtectedWorkload,
  VeeamRestorePoint,
  VeeamProtectionGroup,
  ProtectionGroupsResult,
  VeeamDiscoveredEntity,
  DiscoveredEntitiesResult,
  VeeamUnstructuredServer,
  UnstructuredServersResult,
  VeeamCredential,
  VeeamRepositoryDetailed,
  VeeamRepository,
  VeeamRepositoryState,
  VeeamRepositoryEnriched,
  VeeamProxy,
  VeeamProxyState,
  ProxiesResult,
  ProxyStatesResult,
  VeeamInventoryItem,
  InventoryResult,
  VeeamBackupObject,
  BackupObjectsResult,
  VeeamUser,
  VeeamRole,
  UsersResult,
  RolesResult,
  RolePermissionsResult,
  SecuritySettings,
  VeeamServerInfo
} from '@/lib/types/veeam';
import { VBMJob, VBMJobsResponse, VBMJobSession, VBMJobSessionsResponse, VBMLicense, VBMHealth, VBMServiceInstance, VBMOrganization, VBMOrganizationsResponse, VBMUsedRepositoriesResponse, VBMUsedRepository, VBMProtectedUser, VBMProtectedUsersResponse, VBMProtectedGroup, VBMProtectedGroupsResponse, VBMProtectedSite, VBMProtectedSitesResponse, VBMProtectedTeam, VBMProtectedTeamsResponse, VBMRestorePoint, VBMRestorePointsResponse, VBMBackupRepository, VBMBackupRepositoriesResponse, VB365LicensedUser, VB365LicensedUsersResponse, VB365Proxy, VB365ProxiesResponse, VB365Repository, VB365RepositoriesResponse } from '@/lib/types/vbm';
import { RateLimiter } from '@/lib/utils/rate-limiter';
import { goBackendClient, GoBackendServer } from '@/lib/api/go-backend-client';

// Product type mapping for API prefixes
type ProductType = 'vbr' | 'vro' | 'vbm' | 'vb365' | 'k10';

interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  '.issued': string;
  '.expires': string;
  username: string;
}

class VeeamApiClient {
  // Legacy token fields - kept for interface compatibility but not used
  // All authentication is now handled by the Go backend
  private token: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private vroToken: string | null = null;
  private vroRefreshToken: string | null = null;
  private vroTokenExpiry: Date | null = null;
  private vbmToken: string | null = null;
  private vbmRefreshToken: string | null = null;
  private vbmTokenExpiry: Date | null = null;

  // Rate limiter kept for future use if needed
  private vbmRateLimiter = new RateLimiter(1);

  // Go backend integration - cache server lookups
  private serverCache: Map<ProductType, GoBackendServer | null> = new Map();
  private serverCacheExpiry: Date | null = null;
  private useGoBackend: boolean | null = null;

  /**
   * Ensure Go backend is available - this is required for standalone mode
   * Throws an error if backend is not reachable
   */
  private async ensureGoBackendAvailable(): Promise<void> {
    // Only check once per session (or until explicitly cleared)
    if (this.useGoBackend === true) {
      return;
    }

    // Verify backend is actually reachable
    try {
      await goBackendClient.checkHealth();
      this.useGoBackend = true;
      console.log('[VeeamClient] Go backend is available');
    } catch (error) {
      this.useGoBackend = false;
      throw new Error('Go backend is not reachable. Please ensure the backend service is running.');
    }
  }

  /**
   * Get the primary server for a product type from Go backend
   * Throws an error if no server is configured
   */
  private async getServerForProduct(productType: ProductType): Promise<GoBackendServer> {
    // Ensure backend is available first
    await this.ensureGoBackendAvailable();

    // Check cache (5 minute expiry)
    const now = new Date();
    if (this.serverCacheExpiry && now < this.serverCacheExpiry && this.serverCache.has(productType)) {
      const cachedServer = this.serverCache.get(productType);
      if (cachedServer) {
        return cachedServer;
      }
    }

    try {
      const server = await goBackendClient.getPrimaryServer(productType);
      if (server) {
        this.serverCache.set(productType, server);
        this.serverCacheExpiry = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
        return server;
      }
    } catch (error) {
      console.warn(`[VeeamClient] Failed to get ${productType} server:`, error);
    }

    // No server configured - throw a helpful error
    throw new Error(
      `No ${productType.toUpperCase()} server configured. ` +
      `Please add a ${productType.toUpperCase()} server in Administration > Servers > Connections.`
    );
  }

  /**
   * Clear server cache (call when servers are added/removed)
   */
  public clearServerCache(): void {
    this.serverCache.clear();
    this.serverCacheExpiry = null;
    this.useGoBackend = null;
  }

  /**
   * Determine product type from API prefix
   */
  private getProductTypeFromPrefix(prefix: string): ProductType {
    if (prefix.includes('/vro')) return 'vro';
    if (prefix.includes('/vbm')) return 'vbm';
    return 'vbr'; // Default to VBR
  }

  /**
   * Make a request through the Go backend proxy
   * No fallback to legacy mode - Go backend is required
   */
  private async request<T>(endpoint: string, options?: RequestInit & { apiPrefix?: string }): Promise<T> {
    const prefix = options?.apiPrefix ?? '/api/veeam';
    const productType = this.getProductTypeFromPrefix(prefix);

    // Get the server for this product type (throws if not available)
    const server = await this.getServerForProduct(productType);

    // Ensure server is authenticated
    const tokenStatus = await goBackendClient.getTokenStatus(server.id);
    if (!tokenStatus.hasToken || tokenStatus.isExpired) {
      console.log(`[VeeamClient] Authenticating ${productType} server via Go backend`);
      await goBackendClient.authenticateServer(server.id);
    }

    // Map the endpoint to the correct Veeam API path
    const apiPath = this.mapEndpointToApiPath(endpoint, productType);

    const method = options?.method?.toUpperCase() || 'GET';
    
    if (method === 'GET') {
      return await goBackendClient.proxyGet<T>(server.id, apiPath);
    } else if (method === 'POST') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPost<T>(server.id, apiPath, body);
    } else if (method === 'PUT') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPut<T>(server.id, apiPath, body);
    } else if (method === 'DELETE') {
      return await goBackendClient.proxyDelete<T>(server.id, apiPath);
    }
    
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  /**
   * Map frontend endpoint to actual Veeam API path
   */
  private mapEndpointToApiPath(endpoint: string, productType: ProductType): string {
    // VBR endpoints are already correct (e.g., /jobs, /sessions)
    // They map to VBR's /api/v1/* 
    if (productType === 'vbr') {
      return `/api/v1${endpoint}`;
    }
    
    // VBM/VB365 endpoints need /v7 prefix
    if (productType === 'vbm' || productType === 'vb365') {
      return `/v7${endpoint}`;
    }
    
    // VRO endpoints need /api/v1 prefix
    if (productType === 'vro') {
      return `/api/v1${endpoint}`;
    }
    
    return endpoint;
  }

  async logout(): Promise<void> {
    // Clear cached data
    this.clearServerCache();
    this.token = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Fetches all backup jobs from VBR with optional filtering and pagination.
   *
   * Attempts to use the enhanced /jobs/states endpoint for richer data,
   * with automatic fallback to /jobs for older VBR versions.
   *
   * @param options - Optional filtering and pagination parameters
   * @param options.skip - Number of records to skip (pagination)
   * @param options.limit - Maximum number of records to return
   * @param options.orderColumn - Column to sort by
   * @param options.orderAsc - Sort ascending if true
   * @param options.nameFilter - Filter by job name
   * @param options.typeFilter - Filter by job type
   * @returns Array of backup jobs
   * @throws Error if neither endpoint is available
   */
  async getBackupJobs(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamBackupJob[]> {
    const params = new URLSearchParams();
    if (options?.skip !== undefined) params.append('skip', options.skip.toString());
    if (options?.limit !== undefined) params.append('limit', options.limit.toString());
    if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
    if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
    if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

    const queryString = params.toString();
    
    try {
      // Try the new /jobs/states endpoint for better performance and more data
      const endpoint = queryString ? `/jobs/states?${queryString}` : '/jobs/states';
      const response = await this.request<JobsResult>(endpoint);
      return response.data || [];
    } catch (statesError) {
      // Fallback to basic /jobs endpoint if /jobs/states fails (VBR version compatibility)
      console.warn('Failed to fetch from /jobs/states, falling back to /jobs:', statesError);
      try {
        const endpoint = queryString ? `/jobs?${queryString}` : '/jobs';
        const response = await this.request<JobsResult>(endpoint);
        return response.data || [];
      } catch (error) {
        console.error('Error fetching backup jobs:', error);
        throw error;
      }
    }
  }

  /**
   * Fetches a single backup job by ID, enriched with state data if available.
   *
   * @param id - UUID of the backup job
   * @returns Backup job with state information
   * @throws Error if job not found
   */
  async getBackupJobById(id: string): Promise<VeeamBackupJob> {
    try {
      // Fetch basic job info
      const basicJob = await this.request<VeeamBackupJob>(`/jobs/${id}`);
      
      // Try to enrich with state data, but don't fail if it's not available
      try {
        const statesResponse = await this.request<JobsResult>(`/jobs/states?idFilter=${id}`);
        const stateJob = statesResponse.data?.find(j => j.id === id);
        if (stateJob) {
          return {
            ...basicJob,
            ...stateJob,
            // Ensure basic fields aren't overwritten with undefined
            name: basicJob.name || stateJob.name,
            type: basicJob.type || stateJob.type,
          };
        }
      } catch (statesError) {
        // /jobs/states may not be available on older VBR versions
        console.warn(`Could not fetch job state for ${id}:`, statesError);
      }

      return basicJob;
    } catch (error) {
      console.error(`Error fetching backup job ${id}:`, error);
      throw error;
    }
  }

  /**
   * Starts a backup job immediately.
   * @param id - UUID of the backup job to start
   */
  async startJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
    } catch (error) {
      console.error(`Error starting job ${id}:`, error);
      throw error;
    }
  }

  async stopJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch (error) {
      console.error(`Error stopping job ${id}:`, error);
      throw error;
    }
  }

  async retryJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'retry' }),
      });
    } catch (error) {
      console.error(`Error retrying job ${id}:`, error);
      throw error;
    }
  }

  async disableJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'disable' }),
      });
    } catch (error) {
      console.error(`Error disabling job ${id}:`, error);
      throw error;
    }
  }

  async enableJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'enable' }),
      });
    } catch (error) {
      console.error(`Error enabling job ${id}:`, error);
      throw error;
    }
  }

  async getSessions(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    jobIdFilter?: string;
    stateFilter?: string;
    resultFilter?: string[];
    createdAfterFilter?: string;
    createdBeforeFilter?: string;
    endedAfterFilter?: string;
    endedBeforeFilter?: string;
  }): Promise<VeeamSession[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.jobIdFilter) params.append('jobIdFilter', options.jobIdFilter);
      if (options?.stateFilter) params.append('stateFilter', options.stateFilter);
      if (options?.resultFilter) {
        options.resultFilter.forEach(r => params.append('resultFilter', r));
      }
      if (options?.createdAfterFilter) params.append('createdAfterFilter', options.createdAfterFilter);
      if (options?.createdBeforeFilter) params.append('createdBeforeFilter', options.createdBeforeFilter);
      if (options?.endedAfterFilter) params.append('endedAfterFilter', options.endedAfterFilter);
      if (options?.endedBeforeFilter) params.append('endedBeforeFilter', options.endedBeforeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/sessions?${queryString}` : '/sessions';

      const response = await this.request<SessionsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching sessions:', error);
      throw error;
    }
  }

  async getSessionById(id: string): Promise<VeeamSession> {
    try {
      return await this.request<VeeamSession>(`/sessions/${id}`);
    } catch (error) {
      console.error(`Error fetching session ${id}:`, error);
      throw error;
    }
  }

  async getJobSessions(jobId: string, limit: number = 10): Promise<VeeamSession[]> {
    return this.getSessions({
      jobIdFilter: jobId,
      limit,
      orderColumn: 'CreationTime',
      orderAsc: false,
    });
  }

  async getManagedServers(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<ManagedServer[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/managedServers?${queryString}` : '/backupInfrastructure/managedServers';

      const response = await this.request<ManagedServersResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching managed servers:', error);
      throw error;
    }
  }

  async getRepositories(): Promise<RepositoryModel[]> {
    try {
      const response = await this.request<RepositoriesResult>('/backupInfrastructure/repositories');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching repositories:', error);
      // Return empty array instead of throwing to prevent dashboard crash
      return [];
    }
  }

  // ============================================
  // Backup Proxies
  // ============================================

  async getBackupProxies(options?: { limit?: number; skip?: number }): Promise<VeeamProxy[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/proxies?${queryString}` : '/backupInfrastructure/proxies';

      const response = await this.request<ProxiesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backup proxies:', error);
      throw error;
    }
  }

  async getBackupProxyStates(options?: { limit?: number; skip?: number }): Promise<VeeamProxyState[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/proxies/states?${queryString}` : '/backupInfrastructure/proxies/states';

      const response = await this.request<ProxyStatesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backup proxy states:', error);
      throw error;
    }
  }

  async enableBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}/enable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error enabling proxy ${id}:`, error);
      throw error;
    }
  }

  async disableBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}/disable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error disabling proxy ${id}:`, error);
      throw error;
    }
  }

  async deleteBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error(`Error deleting proxy ${id}:`, error);
      throw error;
    }
  }

  async getEnrichedBackupProxies(): Promise<VeeamProxy[]> {
    try {
      const [proxiesRes, statesRes, serversRes] = await Promise.allSettled([
        this.getBackupProxies({ limit: 500 }), // Fetch enough to cover basic needs
        this.getBackupProxyStates({ limit: 500 }),
        this.getManagedServers({ limit: 500 })
      ]);

      const proxies = proxiesRes.status === 'fulfilled' ? proxiesRes.value : [];
      const states = statesRes.status === 'fulfilled' ? statesRes.value : [];
      const servers = serversRes.status === 'fulfilled' ? serversRes.value : [];

      const stateMap = new Map(states.map(s => [s.id, s]));
      const serverMap = new Map(servers.map(s => [s.id, s]));

      return proxies.map(proxy => {
        const state = stateMap.get(proxy.id);
        const server = serverMap.get(proxy.server.hostId);

        // Calculate final name: Use managed server name if available, especially if hostName is "This server"
        // User requested extracting "final name" from managed server call.
        const derivedName = server ? server.name : proxy.name;

        return {
          ...proxy,
          name: derivedName, // Use the managed server name as the primary name
          description: server?.description || proxy.description, // Prefer server description
          osType: server?.type,
          isOnline: state?.isOnline,
          isDisabled: state?.isDisabled,
          isOutOfDate: state?.isOutOfDate,
          isVBRLinuxAppliance: server?.isVBRLinuxAppliance
        };
      });
    } catch (error) {
      console.error('Error fetching enriched proxies:', error);
      return [];
    }
  }

  async getLicenseInfo(): Promise<LicenseModel | null> {
    try {
      // The API endpoint might return direct model or wrapped
      // Based on Swagger proxy: /api/v1/license
      return await this.request<LicenseModel>('/license');
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      // Check if it's a permission error
      if (err?.status === 403 || err?.message?.includes('403') || err?.message?.includes('Permission denied')) {
        console.warn('⚠️ License info unavailable: User lacks GetInstalledLicense permission (Veeam Backup Administrator role required)');
      } else {
        console.error('Error fetching license info:', error);
      }
      return null;
    }
  }

  async revokeLicenseInstance(instanceId: string): Promise<void> {
    try {
      await this.request(`/license/instances/${instanceId}/revoke`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error revoking license instance ${instanceId}:`, error);
      throw error;
    }
  }

  async revokeLicenseCapacity(instanceId: string): Promise<void> {
    try {
      await this.request(`/license/capacity/${instanceId}/revoke`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error revoking license capacity ${instanceId}:`, error);
      throw error;
    }
  }

  async createLicenseReport(): Promise<string> {
    try {
      // The API returns the report HTML directly when reportFormat is html
      // We use application/octet-stream as verified by curl
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.request<any>('/license/createReport', {
        method: 'POST',
        headers: {
          'Accept': 'application/octet-stream'
        },
        body: JSON.stringify({ reportFormat: 'html' })
      });

      // If the response is an object (unexpectedly parsed as JSON or empty), check if it has error or content
      if (typeof response === 'object') {
        if (response.error) return response.error; // In case our request() wrapped it
        // If it's an empty object, it might be 204 or failed parse.
        // We can't recover easily if request() swallowed the text.
        // But let's stringify it just in case it is the JSON report mistakenly returned.
        return JSON.stringify(response);
      }
      return response;
    } catch (error) {
      console.error('Error creating license report:', error);
      throw error;
    }
  }

  async getMalwareEvents(options?: {
    limit?: number;
  }): Promise<MalwareEventModel[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/malware-detection?${queryString}` : '/malware-detection';

      const response = await this.request<MalwareEventsResult>(endpoint);
      return response.data || [];
    } catch {
      // Malware detection may not be available on all VBR versions
      console.warn('Malware detection endpoint not available');
      return [];
    }
  }

  async getSecurityBestPractices(): Promise<SecurityBestPracticeItem[]> {
    try {
      const response = await this.request<SecurityBestPracticesResult>('/security/best-practices');
      return response.items || [];
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      // Check if it's a permission or availability error
      if (err?.message?.includes('404')) {
        console.warn('Security best practices endpoint not available on this VBR version');
      } else if (err?.status === 403 || err?.message?.includes('403') || err?.message?.includes('Permission denied')) {
        console.warn('Security best practices unavailable: User lacks required permissions');
      } else {
        console.warn('Security best practices unavailable:', err?.message || 'Unknown error');
      }
      return [];
    }
  }

  async getSessionTasks(sessionId: string): Promise<VeeamTaskSession[]> {
    try {
      // Fetch details including task sessions
      const response = await this.request<TaskSessionsResult>(`/sessions/${sessionId}/tasks`);
      return response.data || [];
    } catch (error) {
      console.error(`Error fetching tasks for session ${sessionId}:`, error);
      throw error;
    }
  }

  async getProtectedData(): Promise<VeeamProtectedWorkload[]> {
    try {
      // Use the VBR /backupObjects endpoint to get protected workloads
      const response = await this.request<{ data: VeeamProtectedWorkload[] }>('/backupObjects?limit=1000');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching protected data:', error);
      throw error;
    }
  }

  async getBackupFiles(backupId: string): Promise<VeeamBackupFile[]> {
    try {
      // Use the VBR /backups/{id}/backupFiles endpoint
      const response = await this.request<{ data: VeeamBackupFile[] }>(`/backups/${backupId}/backupFiles`);
      return response.data || [];
    } catch (error) {
      console.error(`Error fetching backup files for ${backupId}:`, error);
      throw error;
    }
  }



  async getVBRRestorePoints(params: { objectId?: string, backupId?: string }): Promise<VeeamRestorePoint[]> {
    try {
      const query = new URLSearchParams();
      if (params.objectId) query.append('objectId', params.objectId);
      if (params.backupId) query.append('backupId', params.backupId);

      // Use the VBR /backupObjects endpoint with filters
      const endpoint = query.toString() ? `/backupObjects?${query.toString()}` : '/backupObjects';

      const response = await this.request<{ data: VeeamRestorePoint[] }>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching VBR restore points:', error);
      throw error;
    }
  }

  // ============================================
  // Inventory & Protection Groups
  // ============================================

  async getProtectionGroups(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamProtectionGroup[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/agents/protectionGroups?${queryString}` : '/agents/protectionGroups';

      const response = await this.request<ProtectionGroupsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching protection groups:', error);
      throw error;
    }
  }

  async getProtectionGroupById(id: string): Promise<VeeamProtectionGroup> {
    try {
      return await this.request<VeeamProtectionGroup>(`/agents/protectionGroups/${id}`);
    } catch (error) {
      console.error(`Error fetching protection group ${id}:`, error);
      throw error;
    }
  }

  async rescanProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/rescan`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error rescanning protection group ${id}:`, error);
      throw error;
    }
  }

  async enableProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/enable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error enabling protection group ${id}:`, error);
      throw error;
    }
  }

  async disableProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/disable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error disabling protection group ${id}:`, error);
      throw error;
    }
  }

  async getDiscoveredEntities(groupId: string, options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamDiscoveredEntity[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString
        ? `/agents/protectionGroups/${groupId}/discoveredEntities?${queryString}`
        : `/agents/protectionGroups/${groupId}/discoveredEntities`;

      const response = await this.request<DiscoveredEntitiesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error(`Error fetching discovered entities for group ${groupId}:`, error);
      throw error;
    }
  }

  // Discovered Entity Actions
  private async performDiscoveredEntityAction(groupId: string, action: string, entityIds: string[]): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${groupId}/discoveredEntities/${action}`, {
        method: 'POST',
        body: JSON.stringify({ entityIds })
      });
    } catch (error) {
      console.error(`Error performing ${action} on entities in group ${groupId}:`, error);
      throw error;
    }
  }

  async rescanDiscoveredEntities(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'rescan', entityIds);
  }

  async installAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'installAgent', entityIds);
  }

  async uninstallAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallAgent', entityIds);
  }

  async upgradeAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'upgradeAgent', entityIds);
  }

  async installCBTDriver(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'installCBTDriver', entityIds);
  }

  async uninstallCBTDriver(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallCBTDriver', entityIds);
  }


  async uninstallAllComponents(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallAllComponents', entityIds);
  }

  // ============================================
  // Unstructured Data
  // ============================================

  async getUnstructuredServers(): Promise<VeeamUnstructuredServer[]> {
    try {
      const response = await this.request<UnstructuredServersResult>('/inventory/unstructuredDataServers?limit=200');
      const servers = response.data || [];

      // Enrich with credentials and repository info
      const enrichedServers = await Promise.all(servers.map(async (server) => {
        const enriched = { ...server };

        // Enrich Credentials
        if (server.accessCredentialsId) {
          try {
            const cred = await this.request<VeeamCredential>(`/credentials/${server.accessCredentialsId}`);
            enriched.credentialsName = cred.username;
            enriched.credentialsDescription = cred.description ? ` (${cred.description})` : '';
            enriched.credentialsUserName = cred.username;
            enriched.credentialsCreationTime = cred.creationTime;
          } catch {
            console.warn(`Failed to fetch credentials for server ${server.id}`);
          }
        }

        // Enrich Repository (Cache)
        if (server.processing?.cacheRepositoryId) {
          try {
            const repo = await this.request<VeeamRepositoryDetailed>(`/backupInfrastructure/repositories/${server.processing.cacheRepositoryId}`);
            enriched.repositoryName = repo.name;
            enriched.repositoryDescription = repo.description;
          } catch {
            console.warn(`Failed to fetch repository for server ${server.id}`);
          }
        }

        return enriched;
      }));

      return enrichedServers;
    } catch (error) {
      console.error('Error fetching unstructured servers:', error);
      throw error;
    }
  }

  async deleteUnstructuredServer(id: string): Promise<void> {
    try {
      await this.request(`/inventory/unstructuredDataServers/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error(`Error deleting unstructured server ${id}:`, error);
      throw error;
    }
  }

  // ============================================
  // Virtual Infrastructure Inventory
  // ============================================

  async getInventory(): Promise<VeeamInventoryItem[]> {
    try {
      // 1. Get root objects (vCenters/Servers)
      // We fetch the root nodes first.
      const rootResponse = await this.request<InventoryResult>('/inventory?limit=5000', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const rootItems = rootResponse.data || [];
      const allItems: VeeamInventoryItem[] = [...rootItems];

      // 2. Identify drill-down targets (e.g., vCenterServer)
      // We want to drill down into platforms that hold VMs.
      // Based on user feedback: "type": "vCenterServer"
      const platformsToDrill = ['vCenterServer', 'VMC', 'HyperV', 'SCVMMServer'];

      const drillTargets = rootItems.filter(item => platformsToDrill.includes(item.type));

      // 3. Drill down into each target
      const drillPromises = drillTargets.map(async (target) => {
        try {
          // Use the item's name (e.g., vcsa.jorgedelacruz.es) to fetch its children
          if (!target.name) return [];

          const drillResponse = await this.request<InventoryResult>(`/inventory/${target.name}?limit=5000`, {
            method: 'POST',
            body: JSON.stringify({}) // Fetch everything for this host
          });
          return drillResponse.data || [];
        } catch (e) {
          console.warn(`Failed to drill down into ${target.name}`, e);
          return [];
        }
      });

      const drilledResults = await Promise.all(drillPromises);

      drilledResults.forEach(items => {
        allItems.push(...items);
      });

      return allItems;

    } catch (error) {
      console.error('Error fetching inventory:', error);
      throw error;
    }
  }




  // Cache for global search
  private searchInventory: { id: string; name: string; type: string; url: string; description: string; searchStr: string }[] = [];
  private inventoryLastUpdated: number = 0;
  private readonly INVENTORY_TTL = 30 * 60 * 1000; // 30 minutes

  private async ensureInventory(): Promise<void> {
    const now = Date.now();
    if (this.searchInventory.length > 0 && (now - this.inventoryLastUpdated < this.INVENTORY_TTL)) {
      return;
    }

    try {
      // Fetch everything without filters



      const [
        vbrJobsRes,
        vbrObjectsRes,
        vbmJobsRes,
        vbmUsersRes,
        vbmGroupsRes,
        vbmSitesRes,
        vbmTeamsRes
      ] = await Promise.allSettled([

        this.getBackupJobs({}), // No filter
        this.getProtectedData(),
        this.requestVBM<VBMJobsResponse>('/jobs?limit=5000'),
        this.requestVBM<VBMProtectedUsersResponse>('/ProtectedUsers?limit=5000'),
        this.requestVBM<VBMProtectedGroupsResponse>('/ProtectedGroups?limit=5000'),
        this.requestVBM<VBMProtectedSitesResponse>('/ProtectedSites?limit=5000'),
        this.requestVBM<VBMProtectedTeamsResponse>('/ProtectedTeams?limit=5000')
      ]);

      const newInventory: { id: string; name: string; type: string; url: string; description: string; searchStr: string }[] = [];

      // Process VBR Jobs
      if (vbrJobsRes.status === 'fulfilled') {
        vbrJobsRes.value.forEach(job => {
          newInventory.push({
            id: job.id,
            name: job.name,
            type: 'VBR Job',
            url: `/vbr/jobs/${job.id}`,
            description: job.type,
            searchStr: (job.name || '').toLowerCase()
          });
        });
      }

      // Process VBR Workloads
      if (vbrObjectsRes.status === 'fulfilled') {
        vbrObjectsRes.value.forEach(obj => {
          newInventory.push({
            id: obj.id,
            name: obj.name,
            type: 'VBR Workload',
            url: `/vbr/protected-data/restore-points?objectId=${obj.id}&name=${encodeURIComponent(obj.name)}`,
            description: obj.platformName,
            searchStr: (obj.name || '').toLowerCase()
          });
        });
      }

      // Process VBM Jobs
      if (vbmJobsRes.status === 'fulfilled') {
        const jobs = vbmJobsRes.value.results || [];
        jobs.forEach((job) => {
          newInventory.push({
            id: job.id,
            name: job.name,
            type: 'VB365 Job',
            url: `/vb365/jobs/${job.id}/sessions`,
            description: job.description,
            searchStr: (job.name || '').toLowerCase()
          });
        });
      }

      // Helper for VBM Items
      interface VBMItem {
        id: string;
        name?: string;
        displayName?: string;
        url?: string;
        email?: string;
        description?: string;
      }
      const processVbmItems = (res: PromiseSettledResult<{ results?: VBMItem[] }>, type: string) => {
        if (res.status === 'fulfilled') {
          const items = res.value.results || [];
          items.forEach((item) => {
            const displayName = item.displayName || item.name || item.url || '';
            const searchTerms = [
              displayName,
              item.email,
              item.description
            ].filter(Boolean).join(' ').toLowerCase();

            newInventory.push({
              id: item.id,
              name: displayName,
              type: 'VB365 Item',
              url: `/vbm/protected-items/restore-points?type=${type}&id=${item.id}&name=${encodeURIComponent(displayName)}`,
              description: `${type} • ${item.email || item.description || ''}`,
              searchStr: searchTerms
            });
          });
        }
      };

      processVbmItems(vbmUsersRes, 'User');
      processVbmItems(vbmGroupsRes, 'Group');
      processVbmItems(vbmSitesRes, 'Site');
      processVbmItems(vbmTeamsRes, 'Team');

      this.searchInventory = newInventory;
      this.inventoryLastUpdated = now;

    } catch (error) {
      console.error('Error building search inventory:', error);
      // Keep old inventory if update fails
    }
  }

  async globalSearch(query: string): Promise<{ id: string; name: string; type: string; url: string; description: string; searchStr: string }[]> {
    if (!query || query.length < 2) return [];

    // Ensure we have data
    await this.ensureInventory();

    const lowerQuery = query.toLowerCase();

    // Perform filtering in memory
    const results = this.searchInventory.filter(item =>
      item.searchStr.includes(lowerQuery)
    );

    // Sort by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    // Limit results
    return results.slice(0, 20);
  }

  // ============================================
  // VBR Server Info and Storage Methods
  // ============================================

  /**
   * Get VBR server information
   */
  async getServerInfo(): Promise<VeeamServerInfo> {
    try {
      return await this.request<VeeamServerInfo>('/serverInfo');
    } catch (error) {
      console.error('Error fetching server info:', error);
      throw error;
    }
  }

  /**
   * Get storage capacity information by aggregating backup data
   */
  async getStorageCapacity(): Promise<{
    totalBackupSize: number;
    totalUsedSpace: number;
    backupCount: number;
    restorePointCount: number;
    byBackup: Array<{ backupName: string; totalSize: number; restorePoints: number }>;
  }> {
    try {
      // Fetch backups
      const backupsResponse = await this.request<BackupsResult>('/backups?limit=500');
      const backups = backupsResponse.data || [];

      // Aggregate data
      let totalBackupSize = 0;
      let restorePointCount = 0;
      const byBackup: Array<{ backupName: string; totalSize: number; restorePoints: number }> = [];

      // Fetch backup files for each backup to get accurate sizes
      await Promise.all(
        backups.map(async (backup) => {
          try {
            const filesResponse = await this.request<{ data?: VeeamBackupFile[] }>(
              `/backups/${backup.id}/backupFiles?limit=1000`
            );
            const files = filesResponse.data || [];

            let backupTotalSize = 0;
            for (const file of files) {
              backupTotalSize += file.backupSize || 0;
            }

            byBackup.push({
              backupName: backup.name,
              totalSize: backupTotalSize,
              restorePoints: files.length
            });

            totalBackupSize += backupTotalSize;
            restorePointCount += files.length;
          } catch {
            // Backup files endpoint may not be available
            console.warn(`Backup files not available for ${backup.name}`);
          }
        })
      );

      return {
        totalBackupSize,
        totalUsedSpace: totalBackupSize, // Same as totalBackupSize for now
        backupCount: backups.length,
        restorePointCount,
        byBackup
      };
    } catch (error) {
      console.error('Error fetching storage capacity:', error);
      throw error;
    }
  }

  // ============================================
  // Veeam Recovery Orchestrator (VRO) Methods
  // ============================================

  /**
   * Request method for VRO - routes through Go backend
   */
  private async requestVRO<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Get the VRO server from Go backend
    const server = await this.getServerForProduct('vro');

    // Ensure server is authenticated
    const tokenStatus = await goBackendClient.getTokenStatus(server.id);
    if (!tokenStatus.hasToken || tokenStatus.isExpired) {
      console.log(`[VeeamClient] Authenticating VRO server via Go backend`);
      await goBackendClient.authenticateServer(server.id);
    }

    // Map the endpoint to the correct VRO API path
    const apiPath = this.mapEndpointToApiPath(endpoint, 'vro');

    const method = options?.method?.toUpperCase() || 'GET';
    
    if (method === 'GET') {
      return await goBackendClient.proxyGet<T>(server.id, apiPath);
    } else if (method === 'POST') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPost<T>(server.id, apiPath, body);
    } else if (method === 'PUT') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPut<T>(server.id, apiPath, body);
    } else if (method === 'DELETE') {
      return await goBackendClient.proxyDelete<T>(server.id, apiPath);
    }
    
    throw new Error(`Unsupported HTTP method: ${method}`);
  }


  async getRecoveryPlans(options?: {
    start?: number;
    limit?: number;
    onlyEnabled?: boolean;
  }): Promise<VRORecoveryPlan[]> {
    try {
      const params = new URLSearchParams();
      if (options?.start !== undefined) params.append('start', options.start.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.onlyEnabled !== undefined) params.append('onlyEnabled', options.onlyEnabled.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/plans?${queryString}` : '/plans';

      const response = await this.requestVRO<PlansResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching recovery plans:', error);
      throw error;
    }
  }

  async getRecoveryPlanById(id: string): Promise<VRORecoveryPlan> {
    try {
      return await this.requestVRO<VRORecoveryPlan>(`/plans/${id}`);
    } catch (error) {
      console.error(`Error fetching recovery plan ${id}:`, error);
      throw error;
    }
  }

  async logoutVRO(): Promise<void> {
    // Clear local VRO tokens
    this.vroToken = null;
    this.vroRefreshToken = null;
    this.vroTokenExpiry = null;
  }

  // ============================================
  // Veeam Backup for Microsoft 365 (VBM) Methods
  // ============================================

  /**
   * Request method for VBM - routes through Go backend
   */
  private async requestVBM<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Get the VBM server from Go backend
    const server = await this.getServerForProduct('vbm');

    // Ensure server is authenticated
    const tokenStatus = await goBackendClient.getTokenStatus(server.id);
    if (!tokenStatus.hasToken || tokenStatus.isExpired) {
      console.log(`[VeeamClient] Authenticating VBM server via Go backend`);
      await goBackendClient.authenticateServer(server.id);
    }

    // Map the endpoint to the correct VBM API path
    const apiPath = this.mapEndpointToApiPath(endpoint, 'vbm');

    const method = options?.method?.toUpperCase() || 'GET';
    
    if (method === 'GET') {
      return await goBackendClient.proxyGet<T>(server.id, apiPath);
    } else if (method === 'POST') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPost<T>(server.id, apiPath, body);
    } else if (method === 'PUT') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      return await goBackendClient.proxyPut<T>(server.id, apiPath, body);
    } else if (method === 'DELETE') {
      return await goBackendClient.proxyDelete<T>(server.id, apiPath);
    }
    
    throw new Error(`Unsupported HTTP method: ${method}`);
  }


  async getVBMJobs(options?: {
    offset?: number;
    limit?: number;
  }): Promise<VBMJob[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/jobs?${queryString}` : '/jobs';

      const response = await this.requestVBM<VBMJobsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM jobs:', error);
      throw error;
    }
  }

  async startVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/start`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error starting VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async stopVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/stop`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error stopping VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async enableVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/enable`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error enabling VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async disableVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/disable`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error disabling VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async getVBMJobSessions(jobId?: string, options?: {
    offset?: number;
    limit?: number;
    endTimeLowerBound?: string;
  }): Promise<VBMJobSession[]> {
    try {
      const params = new URLSearchParams();
      // Use proper server-side filtering with jobId parameter
      if (jobId) params.append('jobId', jobId);
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.endTimeLowerBound) params.append('endTimeLowerBound', options.endTimeLowerBound);

      const queryString = params.toString();
      const endpoint = queryString ? `/JobSessions?${queryString}` : '/JobSessions';

      const response = await this.requestVBM<VBMJobSessionsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error(`Error fetching VBM sessions for job ${jobId}:`, error);
      throw error;
    }
  }

  async getVBMLicense(): Promise<VBMLicense> {
    return this.requestVBM<VBMLicense>('/License')
  }

  async getVB365LicensedUsers(options?: { limit?: number; offset?: number }): Promise<VB365LicensedUser[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/LicensedUsers?${queryString}` : '/LicensedUsers';

      const response = await this.requestVBM<VB365LicensedUsersResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VB365 licensed users:', error);
      return [];
    }
  }

  async revokeVB365License(userId: string): Promise<void> {
    try {
      await this.requestVBM<void>(`/LicensedUsers/${encodeURIComponent(userId)}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Error revoking VB365 license:', error);
      throw error;
    }
  }

  async generateVB365LicenseReport(startTime: string, endTime: string): Promise<Blob> {
    // Note: This method requires blob response support in Go backend
    // For now, use requestVBM to make the request through Go backend
    try {
      // Get the VBM server
      const server = await this.getServerForProduct('vbm');

      // Ensure server is authenticated  
      const tokenStatus = await goBackendClient.getTokenStatus(server.id);
      if (!tokenStatus.hasToken || tokenStatus.isExpired) {
        await goBackendClient.authenticateServer(server.id);
      }

      // Use proxyPost to generate the report
      // The Go backend will return the PDF data as base64 or handle it appropriately
      const result = await goBackendClient.proxyPost<{ data?: string; error?: string }>(
        server.id,
        '/v7/Reports/LicenseOverview',
        {
          startTime,
          endTime,
          format: 'PDF',
          timezone: 'GMT'
        }
      );

      // If the backend returns base64 data, convert it to a Blob
      if (result.data) {
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'application/pdf' });
      }

      throw new Error('No report data returned');
    } catch (error) {
      console.error('Error generating VB365 license report:', error);
      throw error;
    }
  }

  async getVB365Proxies(options?: { limit?: number; offset?: number }): Promise<VB365Proxy[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/Proxies?${queryString}` : '/Proxies';

      const response = await this.requestVBM<VB365ProxiesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VB365 proxies:', error);
      return [];
    }
  }

  async rescanVB365Proxy(proxyId: string): Promise<void> {
    try {
      await this.requestVBM<void>(`/Proxies/${encodeURIComponent(proxyId)}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'rescan' })
      });
    } catch (error) {
      console.error('Error rescanning VB365 proxy:', error);
      throw error;
    }
  }

  async setVB365ProxyMaintenanceMode(proxyId: string, enabled: boolean): Promise<void> {
    try {
      await this.requestVBM<void>(`/Proxies/${encodeURIComponent(proxyId)}`, {
        method: 'POST',
        body: JSON.stringify({ action: enabled ? 'enableMaintenance' : 'disableMaintenance' })
      });
    } catch (error) {
      console.error('Error setting VB365 proxy maintenance mode:', error);
      throw error;
    }
  }

  async getVB365Repositories(options?: { limit?: number; offset?: number }): Promise<VB365Repository[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/BackupRepositories?${queryString}` : '/BackupRepositories';

      const response = await this.requestVBM<VB365RepositoriesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VB365 repositories:', error);
      return [];
    }
  }

  async getVBMHealth(): Promise<VBMHealth> {
    return this.requestVBM<VBMHealth>('/Health')
  }

  async getBackups(params: { limit?: number; offset?: number } = {}): Promise<VeeamBackup[]> {
    try {
      const searchParams = new URLSearchParams();
      if (params.limit !== undefined) searchParams.append('limit', params.limit.toString());
      if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());

      const queryString = searchParams.toString();
      const endpoint = queryString ? `/backups?${queryString}` : '/backups';
      const response = await this.request<BackupsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backups:', error);
      return [];
    }
  }



  async getVBMServiceInstance(): Promise<VBMServiceInstance> {
    return this.requestVBM<VBMServiceInstance>('/ServiceInstance')
  }

  async getVBMOrganizations(options?: {
    offset?: number;
    limit?: number;
    extendedView?: boolean;
  }): Promise<VBMOrganization[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.extendedView !== undefined) params.append('extendedView', options.extendedView.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/Organizations?${queryString}` : '/Organizations';

      const response = await this.requestVBM<VBMOrganizationsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM organizations:', error);
      throw error;
    }
  }

  async getVBMOrganizationUsedRepositories(orgId: string): Promise<VBMUsedRepository[]> {
    try {
      const response = await this.requestVBM<VBMUsedRepositoriesResponse>(`/Organizations/${orgId}/usedRepositories`);
      return response.results || [];
    } catch (error) {
      console.error(`Error fetching used repositories for org ${orgId}:`, error);
      // Return empty array instead of throwing to prevent dashboard calculation failure from one bad org
      return [];
    }
  }

  async getVBMProtectedUsers(options?: { offset?: number; limit?: number }): Promise<VBMProtectedUser[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedUsers?${queryString}` : '/ProtectedUsers';
      const response = await this.requestVBM<VBMProtectedUsersResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected users:', error);
      return [];
    }
  }

  async getVBMProtectedGroups(options?: { offset?: number; limit?: number }): Promise<VBMProtectedGroup[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedGroups?${queryString}` : '/ProtectedGroups';
      const response = await this.requestVBM<VBMProtectedGroupsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected groups:', error);
      return [];
    }
  }

  async getVBMProtectedSites(options?: { offset?: number; limit?: number }): Promise<VBMProtectedSite[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedSites?${queryString}` : '/ProtectedSites';
      const response = await this.requestVBM<VBMProtectedSitesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected sites:', error);
      return [];
    }
  }

  async getVBMProtectedTeams(options?: { offset?: number; limit?: number }): Promise<VBMProtectedTeam[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedTeams?${queryString}` : '/ProtectedTeams';
      const response = await this.requestVBM<VBMProtectedTeamsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected teams:', error);
      return [];
    }
  }

  async getVBMRestorePoints(params: {
    userId?: string;
    groupId?: string;
    siteId?: string;
    teamId?: string;
    limit?: number;
    offset?: number;
  }): Promise<VBMRestorePoint[]> {
    try {
      const searchParams = new URLSearchParams();
      if (params.userId) searchParams.append('userId', params.userId);
      if (params.groupId) searchParams.append('groupId', params.groupId);
      if (params.siteId) searchParams.append('siteId', params.siteId);
      if (params.teamId) searchParams.append('teamId', params.teamId);
      if (params.limit !== undefined) searchParams.append('limit', params.limit.toString());
      if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());

      const queryString = searchParams.toString();
      const endpoint = queryString ? `/RestorePoints?${queryString}` : '/RestorePoints';
      const response = await this.requestVBM<VBMRestorePointsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM restore points:', error);
      return [];
    }
  }

  async getVBMBackupRepositories(options?: { offset?: number; limit?: number }): Promise<VBMBackupRepository[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/BackupRepositories?${queryString}` : '/BackupRepositories';
      const response = await this.requestVBM<VBMBackupRepositoriesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM backup repositories:', error);
      return [];
    }
  }


  // ============================================
  // Backup Objects (Protection Status)
  // ============================================

  async getAllBackupObjects(): Promise<VeeamBackupObject[]> {
    try {
      const allObjects: VeeamBackupObject[] = [];
      let skip = 0;
      const limit = 500; // Fetch in chunks
      let hasMore = true;

      while (hasMore) {
        const response = await this.request<BackupObjectsResult>(`/backupObjects?skip=${skip}&limit=${limit}`);
        const items = response.data || [];

        if (items.length > 0) {
          allObjects.push(...items);
          skip += limit;
        }

        // If we got fewer items than limit, we're done
        if (items.length < limit) {
          hasMore = false;
        }

        // Safety break for extremely large envs to prevent infinite loops if API misbehaves
        if (allObjects.length > 20000) {
          console.warn('Backup objects limit reached (20k), stopping fetch.');
          hasMore = false;
        }
      }

      return allObjects;
    } catch (error) {
      console.error('Error fetching all backup objects:', error);
      return [];
    }
  }
  // ============================================
  // Backup Infrastructure: Repositories
  // ============================================

  async getBackupRepositories(): Promise<VeeamRepository[]> {
    try {
      // Use internal API route which proxies to /api/v1/backupInfrastructure/repositories
      const response = await this.request<{ data: VeeamRepository[] }>('/backupInfrastructure/repositories');
      return response.data;
    } catch (error) {
      console.error('Failed to get backup repositories:', error);
      throw error;
    }
  }

  async getBackupRepositoryStates(): Promise<VeeamRepositoryState[]> {
    try {
      const response = await this.request<{ data: VeeamRepositoryState[] }>('/backupInfrastructure/repositories/states');
      return response.data;
    } catch (error) {
      console.error('Failed to get backup repository states:', error);
      throw error;
    }
  }

  async getEnrichedBackupRepositories(): Promise<VeeamRepositoryEnriched[]> {
    try {
      const [repos, states] = await Promise.all([
        this.getBackupRepositories(),
        this.getBackupRepositoryStates()
      ]);

      const repoMap = new Map(repos.map(r => [r.id, r]));

      return states.map(state => {
        const repo = repoMap.get(state.id);

        // Extract config details
        let taskLimitEnabled = false;
        let maxTaskCount = 0;
        let immutabilityEnabled = false;
        let immutabilityDays = 0;
        let perVmBackup = false;

        if (repo) {
          // Task limits are usually in repository object
          if (repo.repository) {
            taskLimitEnabled = repo.repository.taskLimitEnabled ?? false;
            maxTaskCount = repo.repository.maxTaskCount ?? 0;
            if (repo.repository.advancedSettings) {
              perVmBackup = repo.repository.advancedSettings.perVmBackup ?? false;
            }
          }

          // Immutability in bucket for object storage
          if (repo.bucket?.immutability) {
            immutabilityEnabled = repo.bucket.immutability.isEnabled;
            immutabilityDays = repo.bucket.immutability.daysCount;
          } else if (repo.type === 'LinuxHardened' && repo.repository) {
            // Hardened repository immutability often corresponds to 'makeRecentBackupsImmutableDays' 
            // but the user JSON shows it at the top level of repository object for LinuxHardened?
            // Wait, checking user JSON: 
            // "repository": { "makeRecentBackupsImmutableDays": 7, ... }
            // I need to update my VeeamRepository type to include this field if it's there.
            // Let's add dynamic access or update type.
            const anyRepo = repo.repository as unknown as { makeRecentBackupsImmutableDays?: number };
            if (anyRepo.makeRecentBackupsImmutableDays) {
              immutabilityEnabled = true;
              immutabilityDays = anyRepo.makeRecentBackupsImmutableDays;
            }
          }
        }

        return {
          ...state,
          taskLimitEnabled,
          maxTaskCount,
          immutabilityEnabled,
          immutabilityDays,
          perVmBackup
        };
      });

    } catch (error) {
      console.error('Failed to get enriched backup repositories:', error);
      throw error;
    }
  }

  async rescanBackupRepository(ids: string[]): Promise<void> {
    try {
      return await this.request('/backupInfrastructure/repositories/rescan', {
        method: 'POST',
        body: JSON.stringify({ repositoryIds: ids })
      });
    } catch (error) {
      console.error('Failed to rescan backup repository:', error);
      throw error;
    }
  }

  async deleteBackupRepository(id: string): Promise<void> {
    try {
      return await this.request(`/backupInfrastructure/repositories/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Failed to delete backup repository:', error);
      throw error;
    }
  }


  // ============================================
  // Identity Management
  // ============================================

  async getUsers(options?: { skip?: number; limit?: number }): Promise<VeeamUser[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.skip) params.append('skip', options.skip.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/security/users?${queryString}` : '/security/users';

      const response = await this.request<UsersResult>(endpoint);
      return response.data;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  }

  async deleteUser(id: string): Promise<void> {
    try {
      await this.request(`/security/users/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error(`Error deleting user ${id}:`, error);
      throw error;
    }
  }

  async updateUserRoles(id: string, roles: VeeamRole[]): Promise<void> {
    try {
      await this.request(`/security/users/${id}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ roles })
      });
    } catch (error) {
      console.error(`Error updating roles for user ${id}:`, error);
      throw error;
    }
  }

  async resetMFA(id: string): Promise<void> {
    try {
      await this.request(`/security/users/${id}/resetMFA`, { method: 'POST' });
    } catch (error) {
      console.error(`Error resetting MFA for user ${id}:`, error);
      throw error;
    }
  }

  async changeServiceAccountMode(id: string, isServiceAccountEnable: boolean): Promise<void> {
    try {
      await this.request(`/security/users/${id}/changeServiceAccountMode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isServiceAccountEnable })
      });
    } catch (error) {
      console.error(`Error changing service account mode for user ${id}:`, error);
      throw error;
    }
  }

  async getRoles(): Promise<VeeamRole[]> {
    try {
      const response = await this.request<RolesResult>('/security/roles?limit=500');
      return response.data;
    } catch (error) {
      console.error('Error fetching roles:', error);
      throw error;
    }
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    try {
      const response = await this.request<RolePermissionsResult>(`/security/roles/${roleId}/permissions`);
      return response.permissions;
    } catch (error) {
      console.error(`Error fetching permissions for role ${roleId}:`, error);
      throw error;
    }
  }

  async getSecuritySettings(): Promise<SecuritySettings> {
    try {
      return await this.request<SecuritySettings>('/security/settings');
    } catch (error) {
      console.error('Error fetching security settings:', error);
      throw error;
    }
  }

  async updateSecuritySettings(settings: SecuritySettings): Promise<void> {
    try {
      await this.request('/security/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
    } catch (error) {
      console.error('Error updating security settings:', error);
      throw error;
    }
  }
}

export const veeamApi = new VeeamApiClient();
