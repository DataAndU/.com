import { NotificationCenter } from "@/components/notification-center";

export default function NotificationsPage() {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-2xl font-bold">Notifications</h1>
        <NotificationCenter />
      </div>
    </div>
  );
}