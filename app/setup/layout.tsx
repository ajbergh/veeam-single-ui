import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Setup - Veeam Single-UI",
  description: "Configure your Veeam server connections",
};

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Simple layout - the ConditionalLayout in root will not show sidebar for setup pages
  return (
    <main className="min-h-screen bg-background">
      {children}
    </main>
  );
}
