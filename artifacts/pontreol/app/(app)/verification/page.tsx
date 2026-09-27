import { VerificationPanel } from "@/components/verification-panel";

export default function VerificationPage() {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold">Identity verification</h1>
        <VerificationPanel />
      </div>
    </div>
  );
}