import { AppSidebar } from "@/components/app-sidebar";
import { RoleGuard } from "@/components/role-guard";
import { ForegroundNotifications } from "@/components/notification-center";

// Signed-out visitors are redirected by middleware (no session cookie); the
// API validates the session on every request and RoleGuard handles 401s.
export default function AppLayout({ children }: { children: React.ReactNode }) {
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