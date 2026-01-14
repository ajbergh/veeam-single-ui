/**
 * VBR Section Root Page
 *
 * Redirects to VBR dashboard when accessing /vbr directly.
 *
 * @module app/vbr/page
 */

import { redirect } from 'next/navigation'

export default function VBRPage() {
  redirect('/vbr/dashboard')
}
