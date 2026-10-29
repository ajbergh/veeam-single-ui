import { AsyncLocalStorage } from 'node:async_hooks'
import { Agent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

// Instrumentation and route handlers can occupy separate Next.js bundles.
const runtime = globalThis as typeof globalThis & { veeamAuthenticationOrigin?: AsyncLocalStorage<string> }
const authenticationOrigin = runtime.veeamAuthenticationOrigin ??= new AsyncLocalStorage<string>()

function httpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.origin : undefined
  } catch { return undefined }
}

/** Permit local certificates only on Veeam endpoints, never on unrelated HTTPS. */
export function installVeeamTransport(origins: () => string[], verify = () => process.env.VEEAM_TLS_VERIFY === '1') {
  const previous = getGlobalDispatcher()
  const localCertificates = new Agent({ connect: { rejectUnauthorized: false } })
  class VeeamDispatcher extends Dispatcher {
    dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
      const origin = httpsOrigin(String(options.origin))
      let approved = false
      if (origin && !verify()) {
        try {
          approved = origin === authenticationOrigin.getStore() || origins().some(value => httpsOrigin(value) === origin)
        } catch { /* Configuration failures retain normal certificate validation. */ }
      }
      return (approved ? localCertificates : previous).dispatch(options, handler)
    }
  }
  const dispatcher = new VeeamDispatcher()
  setGlobalDispatcher(dispatcher)
  return async () => {
    if (getGlobalDispatcher() === dispatcher) setGlobalDispatcher(previous)
    await localCertificates.close()
  }
}

/** Also support authentication before a Veeam source has been saved. */
export function veeamFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const origin = httpsOrigin(input instanceof Request ? input.url : String(input))
  const request = () => fetch(input, { ...init, redirect: 'error' })
  return origin ? authenticationOrigin.run(origin, request) : request()
}

export function configuredVeeamOrigins(
  sources: Array<{ platform: string; protocol: string; host: string; port: number }>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const platforms = new Set(['vbr', 'vb365', 'vro', 'one', 'veeam-one'])
  return [
    ...sources.filter(source => platforms.has(source.platform)).map(source => `${source.protocol}://${source.host}:${source.port}`),
    ...['VEEAM_API_URL', 'VBR_API_URL', 'VBM_API_URL', 'VEEAM_ONE_API_URL', 'VRO_API_URL'].map(key => env[key] || ''),
  ].filter(value => httpsOrigin(value))
}
