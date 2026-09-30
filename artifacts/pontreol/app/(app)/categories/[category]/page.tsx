import { redirect } from "next/navigation";

export default async function CategoryRedirect({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  redirect(["services", "spaces", "travel"].includes(category) ? `/home?category=${category}` : "/home");
}
