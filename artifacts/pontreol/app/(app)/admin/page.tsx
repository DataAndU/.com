import { AdminConsole } from "@/components/admin-console";

export default function AdminPage() {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <AdminConsole />
      </div>
    </div>
  );
}