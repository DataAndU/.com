import { GoogleSignIn } from "@/components/google-sign-in";

type Search = Promise<{ next?: string | string[]; error?: string | string[] }>;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export default async function SignUpPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  return <GoogleSignIn mode="sign up" next={first(params.next)} error={first(params.error)} />;
}
