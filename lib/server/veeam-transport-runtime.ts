import { configStore } from './config-store'
import { configuredVeeamOrigins, installVeeamTransport } from './veeam-transport'

const runtime = globalThis as typeof globalThis & { veeamTransportInstalled?: boolean }

export function initializeVeeamTransport() {
  if (runtime.veeamTransportInstalled) return
  installVeeamTransport(() => configuredVeeamOrigins(configStore.getAll()))
  runtime.veeamTransportInstalled = true
}
