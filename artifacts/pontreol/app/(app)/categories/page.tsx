import { redirect } from "next/navigation";

// Categories are filter chips on Explore now.
export default function CategoriesRedirect() {
  redirect("/home");
}
