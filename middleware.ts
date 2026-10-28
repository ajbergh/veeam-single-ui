import { NextRequest, NextResponse } from 'next/server';

// Only desktop builds set this secret. The main process supplies it on local
// requests so other browser tabs cannot use the desktop credential store.
export function middleware(request: NextRequest) {
  const token = process.env.OPEN_BACKUP_UI_DESKTOP_TOKEN;
  // Next's internal image optimizer does not forward request headers when
  // reading a source image. These paths contain public bundled assets only.
  const pathname = request.nextUrl.pathname;
  const publicAsset = pathname.startsWith('/_next/static/') || pathname.startsWith('/images/') ||
    ['/favicon.ico', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/logo.webp'].includes(pathname);
  if (token && !publicAsset && request.headers.get('x-desktop-token') !== token) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.next();
}
