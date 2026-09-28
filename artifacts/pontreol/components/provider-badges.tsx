import { BadgeCheck, Zap, Award } from "lucide-react";

const BADGES: Record<string, { label: string; title: string; icon: typeof BadgeCheck; className: string }> = {
  verified: { label: "Verified", title: "Identity verified by Pontreol", icon: BadgeCheck, className: "bg-sky-500/15 text-sky-300" },
  fastResponder: { label: "Fast responder", title: "Usually replies within 30 minutes", icon: Zap, className: "bg-amber-500/15 text-amber-300" },
  founding: { label: "Founding provider", title: "One of Pontreol's first 100 providers", icon: Award, className: "bg-fuchsia-500/15 text-fuchsia-300" },
};

export function ProviderBadges({ badges }: { badges?: string[] }) {
  const known = (badges || []).filter((badge) => BADGES[badge]);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="provider-badges">
      {known.map((badge) => {
        const { label, title, icon: Icon, className } = BADGES[badge];
        return (
          <span key={badge} title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </span>
        );
      })}
    </div>
  );
}
