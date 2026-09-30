import { NotificationCenter } from "@/components/notification-center";
import { InboxTabs } from "@/components/inbox-tabs";

export default function NotificationsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InboxTabs />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-3xl">
          <NotificationCenter />
        </div>
      </div>
    </div>
  );
}
