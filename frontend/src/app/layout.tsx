import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpsFlow',
  description: 'Incident management for engineering teams',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
