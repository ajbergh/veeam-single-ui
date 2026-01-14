import { redirect } from 'next/navigation';

export default function ServersPage() {
    // Redirect to the connections tab by default
    redirect('/administration/servers/connections');
}
