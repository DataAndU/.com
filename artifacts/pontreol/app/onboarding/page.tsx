"use client";

import { useMe, useUpdateRole } from "@/lib/api/account";
import { User, LogOut, Check } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingPage() {
  const { data: user, isLoading } = useMe();
  const { mutate: updateRole, isPending } = useUpdateRole();
  const router = useRouter();

  useEffect(() => {
    if (user?.role) {
      router.replace("/home");
    }
  }, [user, router]);

  const handleSelectRole = (role: "buyer" | "provider") => {
    updateRole({ role }, {
      onSuccess: () => {
        router.replace("/home");
      }
    });
  };

  if (isLoading) {
    return <div className="min-h-screen w-full bg-background flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-card rounded-2xl border border-border p-8 shadow-xl animate-fade-in relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-[20px]" />
        
        <div className="flex items-center gap-4 mb-8 relative z-10">
          <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center border border-border overflow-hidden">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <User className="w-6 h-6 text-primary" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold">Welcome, {user?.displayName || 'User'}</h2>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-6 relative z-10">
          <div className="text-center mb-6">
            <h3 className="text-xl font-bold mb-2">How will you use Pontreol?</h3>
            <p className="text-muted-foreground text-sm">Select your primary role. This selection is permanent for this account.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              disabled={isPending}
              onClick={() => handleSelectRole("buyer")}
              className="p-6 rounded-xl border border-border bg-background flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-primary/5 transition-all disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Check className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-center">
                <span className="font-semibold text-foreground block mb-1">Buyer</span>
                <span className="text-xs text-muted-foreground">Find equipment, services, and spaces</span>
              </div>
            </button>
            <button 
              disabled={isPending}
              onClick={() => handleSelectRole("provider")}
              className="p-6 rounded-xl border border-border bg-background flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-primary/5 transition-all disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Check className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-center">
                <span className="font-semibold text-foreground block mb-1">Provider</span>
                <span className="text-xs text-muted-foreground">List your assets and skills</span>
              </div>
            </button>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex justify-end relative z-10">
          <SignOutButton>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}