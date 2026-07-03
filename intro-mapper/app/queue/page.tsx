import { getSession } from "@/lib/auth";
import { LoginForm } from "../components/LoginForm";
import { IntroQueue } from "../components/IntroQueue";

export default async function QueuePage() {
  const session = await getSession();
  if (!session) return <LoginForm />;
  return <IntroQueue />;
}
