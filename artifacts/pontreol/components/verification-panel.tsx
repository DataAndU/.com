"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileImage, Loader2, ShieldCheck, Upload } from "lucide-react";
import { fetchApi } from "@/lib/api/client";
import { useVerification } from "@/lib/api/account";

type UploadTicket = {
  mediaId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
};

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function VerificationPanel() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const verification = useVerification();
  const [legalName, setLegalName] = useState("");
  const [idType, setIdType] = useState("aadhaar");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = verification.data?.status as string | undefined;
  const canSubmit = status !== "pending" && status !== "verified";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose one ID photo.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 200 * 1024) {
      setError("The ID photo must be 200 KB or smaller.");
      return;
    }
    if (legalName.trim().length < 2) {
      setError("Enter your full legal name.");
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await fetchApi<UploadTicket>("/media/uploads", {
        method: "POST",
        body: JSON.stringify({
          purpose: "verificationId",
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      const upload = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: ticket.requiredHeaders,
        body: file,
      });
      if (!upload.ok) throw new Error(`Secure photo upload failed (${upload.status}).`);
      await fetchApi(`/media/${ticket.mediaId}/finalize`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await fetchApi("/verification", {
        method: "POST",
        body: JSON.stringify({
          legalName: legalName.trim(),
          idType,
          idMediaId: ticket.mediaId,
        }),
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["verification"] }),
        queryClient.invalidateQueries({ queryKey: ["account", "me"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (verification.isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center" data-testid="status-verification-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (verification.error) {
    return <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-red-300" data-testid="status-verification-error">{verification.error.message}</p>;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 md:p-6" data-testid="panel-verification">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <h2 className="text-lg font-semibold">Identity verification</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your ID remains private and is only available to authorized administrators.</p>
        </div>
      </div>

      {status === "verified" ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm" data-testid="status-verification-verified">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <span>Your identity is verified.</span>
        </div>
      ) : status === "pending" ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100" data-testid="status-verification-pending">
          Your ID is under review. Submitted {verification.data?.submittedAt ? new Date(verification.data.submittedAt).toLocaleString() : "recently"}.
        </div>
      ) : (
        <>
          {status === "rejected" && (
            <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-red-200" data-testid="status-verification-rejected">
              <strong>Previous submission rejected.</strong>
              <p className="mt-1">{verification.data?.rejectionReason || "No reason was provided."}</p>
            </div>
          )}
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="verification-name">Legal name</label>
              <input id="verification-name" data-testid="input-verification-legal-name" className={fieldClass} value={legalName} onChange={(event) => setLegalName(event.target.value)} maxLength={160} autoComplete="name" required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="verification-type">ID type</label>
              <select id="verification-type" data-testid="select-verification-id-type" className={fieldClass} value={idType} onChange={(event) => setIdType(event.target.value)}>
                <option value="aadhaar">Aadhaar</option>
                <option value="passport">Passport</option>
                <option value="drivingLicence">Driving licence</option>
                <option value="voterId">Voter ID</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="verification-file">One ID photo</label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background p-4 hover:border-primary" data-testid="button-choose-verification-photo">
                <FileImage className="h-5 w-5 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">{file?.name || "Choose JPEG, PNG, or WebP (maximum 200 KB)"}</span>
                <Upload className="h-4 w-4 text-muted-foreground" />
                <input ref={fileRef} id="verification-file" data-testid="input-verification-photo" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
            </div>
            {error && <p className="text-sm text-red-300" role="alert" data-testid="status-verification-submit-error">{error}</p>}
            <button data-testid="button-submit-verification" disabled={!canSubmit || submitting} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50" type="submit">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Uploading securely…" : "Submit for review"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}