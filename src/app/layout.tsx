import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

const spaceGrotesk = localFont({
  src: "../fonts/space-grotesk-latin-wght-normal.woff2",
  variable: "--font-space-grotesk",
  weight: "300 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Muscle House Gym OS", template: "%s · Muscle House Gym OS" },
  description: "Membership, CRM and automation operating system for Muscle House.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#080B12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${GeistSans.variable} ${GeistMono.variable} ${spaceGrotesk.variable}`}>
      <body>
        <div className="ambient" aria-hidden />
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            classNames: {
              toast: "!glass !border-0 !text-fg !rounded-2xl",
              description: "!text-muted",
            },
          }}
        />
      </body>
    </html>
  );
}
