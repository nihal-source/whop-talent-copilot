import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intro Mapper",
  description: "Find the best person to make a warm intro across your team's network.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Intro<span>Mapper</span>
          </Link>
          <nav className="nav">
            <Link href="/">Find intros</Link>
            <Link href="/queue">Queue</Link>
            <Link href="/onboarding">Connect data</Link>
            <Link href="/team">Team</Link>
          </nav>
          <div className="who">
            {session ? (
              <>
                <span className="org-chip">{session.org.name}</span>
                <span className="user-name">{session.user.name}</span>
              </>
            ) : (
              <span className="user-name muted">Not signed in</span>
            )}
          </div>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
