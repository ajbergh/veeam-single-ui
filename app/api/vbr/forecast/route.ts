import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import {startCapacityCollector} from '@/lib/server/capacity-collector'
import {readForecastSnapshot,startForecastRefresh} from '@/lib/server/forecast-cache'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  startCapacityCollector()
  startForecastRefresh()
  return withVbrRead(request,async(read,sourceName,_inventory,context)=>{
    return readForecastSnapshot(read,sourceName,context,{force:request.nextUrl.searchParams.get('refresh')==='1',signal:context.signal})
  })
}
