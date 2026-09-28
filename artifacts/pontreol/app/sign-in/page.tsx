import { EmailSignIn } from "@/components/email-sign-in";

type Search = Promise<{ next?: string | string[] }>;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  return <EmailSignIn mode="sign in" next={first(params.next)} />;
}
