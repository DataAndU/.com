"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  MapPin, 
  Search, 
  List, 
  Inbox, 
  MessageSquare, 
  Settings, 
  CreditCard, 
  ShieldAlert,
  Menu,
  X,
  Bell,
  Grid,
  QrCode,
  Building,
  MoreHorizontal
} from "lucide-react";
import { useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { AvailabilityToggle } from "@/components/availability-toggle";

import { useMe } from "@/lib/api/account";
import { LanguagePicker, useT } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

const routes = [
  { name: "Map", key: "nav.map" as const, path: "/home", icon: MapPin },
  { name: "Categories", key: "nav.categories" as const, path: "/categories", icon: Grid },
  { name: "Discover", key: "nav.discover" as const, path: "/discover", icon: Search },
  { name: "My Listings", key: "nav.myListings" as const, path: "/listings", icon: List, providerOnly: true },
  { name: "Requests", key: "nav.requests" as const, path: "/requests", icon: Inbox },
  { name: "Messages", key: "nav.messages" as const, path: "/messages", icon: MessageSquare },
  { name: "Notifications", key: "nav.notifications" as const, path: "/notifications", icon: Bell },
  { name: "My Society", key: "nav.society" as const, path: "/society", icon: Building },
  { name: "Poster", key: "nav.poster" as const, path: "/poster", icon: QrCode },
  { name: "Settings", key: "nav.settings" as const, path: "/settings", icon: Settings },
  { name: "Billing", key: "nav.billing" as const, path: "/billing", icon: CreditCard },
  { name: "Admin", key: "nav.admin" as const, path: "/admin", icon: ShieldAlert, adminOnly: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: user } = useMe();
  const t = useT();

  return (
    <>
      {/* Mobile Topbar */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Pontreol" className="w-8 h-8" />
          <span className="font-bold uppercase tracking-tight text-foreground">Pontreol</span>
        </div>
        <div className="flex items-center gap-4">
          <AccountMenu size={8} />
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-foreground">
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Sidebar (Desktop) / Mobile Menu */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 flex flex-col",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="hidden md:flex items-center gap-3 p-6 border-b border-border">
          <img src="/logo.svg" alt="Pontreol" className="w-8 h-8" />
          <span className="font-bold text-lg uppercase tracking-tight text-foreground">Pontreol</span>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          <AvailabilityToggle />
          {routes.map((route) => {
            if (route.adminOnly && !user?.isAdmin) return null;
            if (route.providerOnly && user?.role !== "provider") return null;

            const isActive = pathname === route.path || pathname.startsWith(`${route.path}/`);
            return (
              <Link
                key={route.path}
                href={route.path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                <route.icon className="w-5 h-5" />
                {t(route.key)}
              </Link>
            );
          })}
        </div>

        <div className="px-4 pb-4 flex gap-2"><LanguagePicker className="flex-1 min-w-0" /><ThemeToggle /></div>
        <div className="p-4 border-t border-border hidden md:flex items-center gap-3">
          <AccountMenu size={10} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{t("account")}</p>
            <p className="text-xs text-muted-foreground truncate">{t("manageProfile")}</p>
          </div>
        </div>
      </div>

      {/* Mobile bottom tab bar: the main screens as big thumb-sized icons. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className="grid grid-cols-5">
          {[
            { key: "nav.map" as const, path: "/home", icon: MapPin },
            { key: "nav.discover" as const, path: "/discover", icon: Search },
            { key: "nav.requests" as const, path: "/requests", icon: Inbox },
            { key: "nav.messages" as const, path: "/messages", icon: MessageSquare },
          ].map((tab) => {
            const active = pathname === tab.path || pathname.startsWith(`${tab.path}/`);
            return (
              <Link key={tab.path} href={tab.path} onClick={() => setMobileMenuOpen(false)}
                className={cn("flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                <tab.icon className="w-6 h-6" />
                <span className="truncate max-w-full px-1">{t(tab.key)}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-expanded={mobileMenuOpen}
            className={cn("flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium", mobileMenuOpen ? "text-primary" : "text-muted-foreground")}>
            <MoreHorizontal className="w-6 h-6" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </>
  );
}