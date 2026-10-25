import { signInAction } from "@/app/actions";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return <AuthForm mode="login" action={signInAction} />;
}
