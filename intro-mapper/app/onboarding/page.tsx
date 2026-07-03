import { getSession } from "@/lib/auth";
import { LoginForm } from "../components/LoginForm";
import { Onboarding } from "../components/Onboarding";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) return <LoginForm />;
  return <Onboarding />;
}
