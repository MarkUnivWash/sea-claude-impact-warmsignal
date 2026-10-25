import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Geist({ variable: "--font-sans-face", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WarmSignal",
  description: "Be the person who always has something valuable to give.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white/70 backdrop-blur">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
            <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
              Warm<span className="text-amber-600">Signal</span>
            </Link>
            <Link href="/" className="text-sm text-stone-600 hover:text-stone-900">
              Briefing
            </Link>
            <Link href="/contacts" className="text-sm text-stone-600 hover:text-stone-900">
              Contacts
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
