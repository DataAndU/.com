import { SignUp } from "@clerk/nextjs";
import { AuthLoading } from "@/components/auth-loading";

export default function Page() {
  return (
    <AuthLoading action="sign up">
      <SignUp />
    </AuthLoading>
  );
}