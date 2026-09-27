import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { RoleGuard } from "@/components/role-guard";
import { ForegroundNotifications } from "@/components/notification-center";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background overflow-hidden md:flex-row">
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative isolate z-0">
        <RoleGuard>
          <ForegroundNotifications />
          {children}
        </RoleGuard>
      </main>
    </div>
  );
}