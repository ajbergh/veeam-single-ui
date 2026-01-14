/**
 * Root Page
 *
 * Application entry point - redirects to VBR dashboard.
 * Acts as the default landing page for the application.
 *
 * @module app/page
 */

import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/vbr/dashboard')
}