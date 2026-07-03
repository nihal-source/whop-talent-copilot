import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { NavLinks } from "./components/NavLinks";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Intro Mapper",
  description: "Find the best person to make a warm intro across your team's network.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden />
            Intro<span>Mapper</span>
          </Link>
          <NavLinks />
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
