import { redirect } from "next/navigation";

// "Urgent" = Explore filtered to people available right now.
export default function EmergencyRedirect() {
  redirect("/home?when=now");
}
