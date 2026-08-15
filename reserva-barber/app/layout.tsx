import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The scaffold's generated values survived until B1 because every page so far
// was behind a login. `/b/{slug}` is the first page a client sees, and the first
// whose title can end up in a browser tab, a bookmark or a shared link.
export const metadata: Metadata = {
  title: "Reserva Barber",
  description: "Reservá tu turno en la barbería.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // es-AR, not en: every user-facing string in this product is Spanish
    // (base-standards.md §2). The attribute lives on the root document, so this
    // is the only place it can be set — and until now a screen reader announced
    // the whole product with English phonetics.
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
