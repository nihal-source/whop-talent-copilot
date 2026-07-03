"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Find intros" },
  { href: "/queue", label: "Queue" },
  { href: "/onboarding", label: "Connect data" },
  { href: "/team", label: "Team" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
