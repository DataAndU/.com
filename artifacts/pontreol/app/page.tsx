import Link from "next/link";
import { Hammer, LayoutGrid, Box, Car, Building2, ChevronRight } from "lucide-react";

// Visitors with a session cookie are sent to /home by middleware.
export default function LandingPage() {
  const categories = [
    { icon: Hammer, label: "Services" },
    { icon: LayoutGrid, label: "Equipment" },
    { icon: Box, label: "Delivery" },
    { icon: Car, label: "Travel" },
    { icon: Building2, label: "Spaces" },
  ];

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-md animate-fade-in">
          {/* Logo & Header */}
          <div className="flex flex-col items-center text-center mb-10">
            <img src="/logo.svg" alt="Pontreol Logo" className="w-20 h-20 mb-6 drop-shadow-lg" />
            <h1 className="text-3xl font-bold tracking-tight mb-2 uppercase text-white">Pontreol</h1>
            <p className="text-muted-foreground">Connect locally for everything you need.</p>
          </div>

          {/* Categories Grid */}
          <div className="flex flex-wrap justify-center gap-3 mb-10 animation-delay-100 animate-fade-in opacity-0">
            {categories.map((c, i) => (
              <div key={i} className="flex flex-col items-center justify-center w-28 p-4 rounded-xl bg-card border border-border/50 shadow-sm hover:bg-card/80 transition-colors">
                <c.icon className="w-6 h-6 text-primary mb-2" />
                <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>

          {/* Auth Actions */}
          <div className="flex flex-col gap-4 animation-delay-200 animate-fade-in opacity-0">
            <Link 
              href="/sign-in" 
              className="w-full flex items-center justify-between p-4 rounded-xl bg-secondary text-secondary-foreground font-medium hover:bg-secondary/90 transition-colors shadow-lg hover:shadow-xl active:scale-[0.98]"
            >
              <span>Sign in to continue</span>
              <ChevronRight className="w-5 h-5 opacity-70" />
            </Link>
            
            <p className="text-center text-xs text-muted-foreground mt-4">
              Don't have an account? <Link href="/sign-up" className="text-primary hover:underline">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}