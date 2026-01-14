'use client';

import { useState } from 'react';
import { useVeeamServers, useGoBackendStatus, useCacheManagement } from '@/hooks/use-go-backend';
import { goBackendClient, CacheConfig, RateLimitStatus } from '@/lib/api/go-backend-client';
import { AdministrationNav } from '@/components/administration-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  Database, 
  RefreshCw, 
  Trash2,
  AlertCircle,
  Clock,
  Zap,
  HardDrive,
  TrendingUp
} from 'lucide-react';
import { useEffect } from 'react';

const sidebarNavItems = [
  {
    title: "Connections",
    href: "/administration/servers/connections",
  },
  {
    title: "Cache",
    href: "/administration/servers/cache",
  },
];

export default function CacheManagementPage() {
  const { isAvailable, isChecking } = useGoBackendStatus();
  const { servers } = useVeeamServers();
  const { stats, isLoading, error, refresh, invalidateAll, invalidateServer } = useCacheManagement();
  
  const [cacheConfig, setCacheConfig] = useState<CacheConfig | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitStatus | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    if (isAvailable) {
      goBackendClient.getCacheConfig().then(setCacheConfig).catch(console.error);
      goBackendClient.getRateLimitStatus().then(setRateLimits).catch(console.error);
    }
  }, [isAvailable]);

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await invalidateAll();
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearServer = async (serverId: string) => {
    try {
      await invalidateServer(serverId);
    } catch (err) {
      console.error('Failed to clear server cache:', err);
    }
  };

  const handleResetRateLimit = async (serverId: string) => {
    try {
      await goBackendClient.resetServerRateLimit(serverId);
      // Refresh rate limits
      const updated = await goBackendClient.getRateLimitStatus();
      setRateLimits(updated);
    } catch (err) {
      console.error('Failed to reset rate limit:', err);
    }
  };

  if (isChecking) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium">Cache Management</h3>
          <p className="text-sm text-muted-foreground">
            View and manage the API response cache.
          </p>
        </div>
        <Separator />
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Cache Management</h3>
            <p className="text-sm text-muted-foreground">
              View and manage the API response cache.
            </p>
          </div>
          <AdministrationNav items={sidebarNavItems} />
        </div>
        <Separator />
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="h-5 w-5" />
              Go Backend Not Available
            </CardTitle>
            <CardDescription>
              Cache management requires the Go backend server to be running.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const maxCacheMB = cacheConfig?.maxCacheSize ? cacheConfig.maxCacheSize / (1024 * 1024) : 50;
  const usedMB = stats?.totalSize ? stats.totalSize / (1024 * 1024) : 0;
  const usagePercent = (usedMB / maxCacheMB) * 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Cache Management</h3>
          <p className="text-sm text-muted-foreground">
            View and manage the API response cache. Cached data is encrypted at rest.
          </p>
        </div>
        <AdministrationNav items={sidebarNavItems} />
      </div>
      <Separator />

      {/* Cache Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Entries</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEntries ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hit Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats ? `${(stats.hitRate * 100).toFixed(1)}%` : '0%'}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.hitCount ?? 0} hits / {stats?.missCount ?? 0} misses
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Size</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usedMB.toFixed(2)} MB</div>
            <Progress value={usagePercent} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-1">
              of {maxCacheMB} MB max
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compression</CardTitle>
            <Zap className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cacheConfig?.compression ? 'Enabled' : 'Disabled'}
            </div>
            <p className="text-xs text-muted-foreground">
              Gzip compression
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isClearing || (stats?.totalEntries ?? 0) === 0}>
              <Trash2 className="h-4 w-4 mr-2" />
              {isClearing ? 'Clearing...' : 'Clear All Cache'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Cache</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete all cached API responses. The next API calls will need to fetch fresh data from the servers.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500 hover:bg-red-600"
                onClick={handleClearAll}
              >
                Clear Cache
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button variant="outline" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="border-red-500/50 bg-red-500/5">
          <CardContent className="pt-6">
            <p className="text-sm text-red-500">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* TTL Configuration */}
      {cacheConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Cache TTL Configuration
            </CardTitle>
            <CardDescription>
              Time-to-live settings for different types of cached data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">Short TTL</p>
                  <p className="text-sm text-muted-foreground">Sessions, tasks, restore points</p>
                </div>
                <Badge variant="secondary">{cacheConfig.shortTTL}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">Medium TTL</p>
                  <p className="text-sm text-muted-foreground">Jobs, repositories, proxies</p>
                </div>
                <Badge variant="secondary">{cacheConfig.mediumTTL}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">Long TTL</p>
                  <p className="text-sm text-muted-foreground">Configuration, backup servers</p>
                </div>
                <Badge variant="secondary">{cacheConfig.longTTL}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">Very Long TTL</p>
                  <p className="text-sm text-muted-foreground">License info, server info</p>
                </div>
                <Badge variant="secondary">{cacheConfig.veryLongTTL}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rate Limits */}
      {rateLimits && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Rate Limiting
            </CardTitle>
            <CardDescription>
              Per-product rate limits to prevent API throttling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Object.entries(rateLimits).map(([product, config]) => (
                <div key={product} className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium uppercase">{product}</p>
                    <Badge variant="outline">{config.RequestsPerSecond}/sec</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Burst: {config.BurstSize} requests
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Server Cache */}
      {servers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Server Cache</CardTitle>
            <CardDescription>
              Manage cache and rate limits per server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{server.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {server.productType.toUpperCase()} · {server.apiUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResetRateLimit(server.id)}
                    >
                      Reset Rate Limit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleClearServer(server.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Clear Cache
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
