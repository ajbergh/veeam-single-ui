export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build') {
    const {initializeVeeamTransport}=await import('./lib/server/veeam-transport-runtime')
    initializeVeeamTransport()
    const {startCapacityCollector}=await import('./lib/server/capacity-collector')
    startCapacityCollector()
    const {startForecastRefresh}=await import('./lib/server/forecast-cache')
    startForecastRefresh()
  }
}
