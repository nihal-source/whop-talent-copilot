import { getSession } from "@/lib/auth";
import { LoginForm } from "../components/LoginForm";
import { TeamAdmin } from "../components/TeamAdmin";

export default async function TeamPage() {
  const session = await getSession();
  if (!session) return <LoginForm />;
  return <TeamAdmin />;
}
