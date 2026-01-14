'use client';

import { useState } from 'react';
import { useVeeamServers, useGoBackendStatus, useBatchAuth, useCacheManagement } from '@/hooks/use-go-backend';
import { GoBackendServer, CreateServerRequest } from '@/lib/api/go-backend-client';
import { AdministrationNav } from '@/components/administration-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  Server, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle,
  Key,
  Database,
  Shield,
  Cloud,
  BarChart
} from 'lucide-react';
import { VEEAM_DEFAULT_PORTS, getProductPlaceholderUrl, getProductPortHelpText } from '@/components/setup-wizard/server-form';

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

const productTypeLabels: Record<GoBackendServer['productType'], string> = {
  vbr: 'Veeam Backup & Replication',
  vro: 'Veeam Recovery Orchestrator',
  vbm: 'Veeam Backup for Microsoft 365',
  vb365: 'Veeam Backup for Microsoft 365',
  k10: 'Kasten K10',
  vone: 'Veeam ONE',
};

const productTypeIcons: Record<GoBackendServer['productType'], React.ReactNode> = {
  vbr: <Server className="h-4 w-4" />,
  vro: <Shield className="h-4 w-4" />,
  vbm: <Cloud className="h-4 w-4" />,
  vb365: <Cloud className="h-4 w-4" />,
  k10: <Database className="h-4 w-4" />,
  vone: <BarChart className="h-4 w-4" />,
};

export default function ServerConnectionsPage() {
  const { isAvailable, isChecking, error: backendError } = useGoBackendStatus();
  const { servers, isLoading, error, refresh, createServer, deleteServer } = useVeeamServers();
  const { authenticateAll, isAuthenticating } = useBatchAuth();
  const { stats: cacheStats } = useCacheManagement();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newServer, setNewServer] = useState<CreateServerRequest>({
    name: '',
    productType: 'vbr',
    apiUrl: '',
    username: '',
    password: '',
  });

  const handleAddServer = async () => {
    try {
      await createServer(newServer);
      setIsAddDialogOpen(false);
      setNewServer({
        name: '',
        productType: 'vbr',
        apiUrl: '',
        username: '',
        password: '',
      });
    } catch (err) {
      console.error('Failed to add server:', err);
    }
  };

  const handleDeleteServer = async (id: string) => {
    try {
      await deleteServer(id);
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  const handleAuthenticateAll = async () => {
    try {
      await authenticateAll();
      refresh();
    } catch (err) {
      console.error('Failed to authenticate:', err);
    }
  };

  // Backend not available
  if (isChecking) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium">Server Connections</h3>
          <p className="text-sm text-muted-foreground">
            Manage your Veeam product connections.
          </p>
        </div>
        <Separator />
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Checking backend status...</span>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Server Connections</h3>
            <p className="text-sm text-muted-foreground">
              Manage your Veeam product connections.
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
              The Go backend server is not running or not configured. Server management requires the Go backend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <p className="font-medium">To enable server management:</p>
              <ol className="list-decimal list-inside mt-2 space-y-1 text-muted-foreground">
                <li>Start the Go backend server: <code className="bg-muted px-1 rounded">cd backend && go run ./cmd/server</code></li>
                <li>Set <code className="bg-muted px-1 rounded">NEXT_PUBLIC_GO_BACKEND_URL=http://localhost:8080</code> in your .env file</li>
                <li>Restart the Next.js development server</li>
              </ol>
            </div>
            {backendError && (
              <p className="text-sm text-red-500">Error: {backendError}</p>
            )}
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Server Connections</h3>
          <p className="text-sm text-muted-foreground">
            Manage your Veeam product connections. Credentials are encrypted using AES-256-GCM.
          </p>
        </div>
        <AdministrationNav items={sidebarNavItems} />
      </div>
      <Separator />

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Authenticated</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers.filter(s => s.tokenStatus === 'valid').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Entries</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cacheStats?.totalEntries ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cacheStats ? `${(cacheStats.hitRate * 100).toFixed(1)}%` : '0%'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add Veeam Server</DialogTitle>
              <DialogDescription>
                Add a new Veeam product server connection. Credentials will be encrypted.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Production VBR"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="productType">Product Type</Label>
                <Select
                  value={newServer.productType}
                  onValueChange={(value: GoBackendServer['productType']) =>
                    setNewServer({ ...newServer, productType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vbr">Veeam Backup & Replication</SelectItem>
                    <SelectItem value="vro">Veeam Recovery Orchestrator</SelectItem>
                    <SelectItem value="vbm">Veeam Backup for Microsoft 365</SelectItem>
                    <SelectItem value="vone">Veeam ONE</SelectItem>
                    <SelectItem value="k10">Kasten K10</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apiUrl">API URL</Label>
                <Input
                  id="apiUrl"
                  placeholder={getProductPlaceholderUrl(newServer.productType)}
                  value={newServer.apiUrl}
                  onChange={(e) => setNewServer({ ...newServer, apiUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {getProductPortHelpText(newServer.productType)}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="administrator"
                  value={newServer.username}
                  onChange={(e) => setNewServer({ ...newServer, username: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={newServer.password}
                  onChange={(e) => setNewServer({ ...newServer, password: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddServer}>Add Server</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="outline" onClick={handleAuthenticateAll} disabled={isAuthenticating || servers.length === 0}>
          <Key className="h-4 w-4 mr-2" />
          {isAuthenticating ? 'Authenticating...' : 'Authenticate All'}
        </Button>

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

      {/* Server List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No servers configured</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a Veeam server to get started.
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onDelete={handleDeleteServer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ServerCardProps {
  server: GoBackendServer;
  onDelete: (id: string) => void;
}

function ServerCard({ server, onDelete }: ServerCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          {productTypeIcons[server.productType]}
          <div>
            <CardTitle className="text-base">{server.name}</CardTitle>
            <CardDescription className="text-xs">
              {productTypeLabels[server.productType]}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge 
            variant={server.tokenStatus === 'valid' ? 'default' : server.tokenStatus === 'expired' ? 'destructive' : 'secondary'}
          >
            {server.tokenStatus === 'valid' ? 'Authenticated' : server.tokenStatus === 'expired' ? 'Expired' : 'Not Connected'}
          </Badge>
          {server.isDefault && (
            <Badge variant="outline">Default</Badge>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Server</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{server.name}&quot;? This will remove all cached data and tokens for this server.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-500 hover:bg-red-600"
                  onClick={() => onDelete(server.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">API URL</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs">{server.apiUrl}</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Username</span>
            <span>{server.username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Added</span>
            <span>{new Date(server.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
