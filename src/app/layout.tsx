import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { House, LogOut, Users } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { AddContactModal } from "@/components/add-contact-modal";
import { NavLink } from "@/components/nav-link";
import { Logo } from "@/components/ui";
import { currentUserEmail } from "@/lib/auth";
import { defaultEvalDate } from "@/lib/briefing";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ variable: "--font-sans-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WarmSignal",
  description: "Be the person who always has something valuable to give.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const email = await currentUserEmail();
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-slate-900">
        {email ? <AppShell email={email}>{children}</AppShell> : <main className="min-h-screen">{children}</main>}
      </body>
    </html>
  );
}

function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const nav = (
    <>
      <NavLink href="/">
        <House className="size-5" strokeWidth={1.75} /> Today
      </NavLink>
      <NavLink href="/contacts">
        <Users className="size-5" strokeWidth={1.75} /> Contacts
      </NavLink>
    </>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white px-5 py-7 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2 text-xl font-bold tracking-tight text-slate-950">
          <Logo /> WarmSignal
        </Link>
        <nav className="mt-10 space-y-1">{nav}</nav>
        <div className="mt-6 border-t border-slate-100 pt-6">
          <AddContactModal defaultDate={defaultEvalDate()} />
        </div>
        <form action={signOutAction} className="mt-auto flex items-center gap-3 rounded-xl px-2 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-50 text-sm font-semibold text-ink-800">
            {email[0]!.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={email}>
            {email}
          </span>
          <button type="submit" title="Sign out" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <LogOut className="size-4" />
          </button>
        </form>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="mr-2 flex items-center gap-2 font-bold tracking-tight">
            <Logo size={20} /> WarmSignal
          </Link>
          <nav className="flex gap-1 [&_a]:px-2.5 [&_a]:py-1.5 [&_a]:text-sm">{nav}</nav>
          <div className="ml-auto">
            <AddContactModal defaultDate={defaultEvalDate()} compact />
          </div>
        </header>
        <div className="relative overflow-hidden">
          <Glow />
          <main className="relative mx-auto max-w-5xl px-5 py-10 sm:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Soft indigo wave in the top-right corner, behind page content. */
function Glow() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute -top-10 right-0 h-[320px] w-[min(720px,70%)]"
      viewBox="0 0 720 320"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="glow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#eef2ff" stopOpacity="0" />
          <stop offset="0.6" stopColor="#e0e7ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#c7d2fe" />
        </linearGradient>
        <filter id="glow-blur">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <path d="M120 320 C 300 300, 420 160, 560 80 S 720 0, 760 -20 L 760 320 Z" fill="url(#glow)" filter="url(#glow-blur)" />
      <path d="M300 320 C 450 290, 560 190, 650 110 S 740 40, 760 30" fill="none" stroke="#c7d2fe" strokeOpacity="0.6" strokeWidth="1.5" />
    </svg>
  );
}
