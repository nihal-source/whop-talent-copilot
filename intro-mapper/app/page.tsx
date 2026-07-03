import { getSession } from "@/lib/auth";
import { LoginForm } from "./components/LoginForm";
import { Finder } from "./components/Finder";

export default async function HomePage() {
  const session = await getSession();
  if (!session) return <LoginForm />;
  return <Finder />;
}
