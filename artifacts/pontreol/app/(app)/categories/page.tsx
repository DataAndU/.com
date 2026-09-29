"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { Wrench, Home, Truck, Compass, ArrowRight } from "lucide-react";

const CATEGORIES = [
  { id: "services", name: "Services", description: "Find skilled professionals and local services", icon: Wrench },
  { id: "spaces", name: "Spaces", description: "Book rooms, venues, and storage spaces", icon: Home },
  { id: "delivery", name: "Delivery", description: "Local transport and moving services", icon: Truck },
  { id: "travel", name: "Travel", description: "Rideshares and trips", icon: Compass },
];

export default function CategoriesPage() {
  const t = useT();
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="border-b border-border bg-card px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">{t("nav.categories")}</h1>
          <p className="text-muted-foreground">Browse local availability or offer your own.</p>
        </div>
      </div>
      
      <div className="flex-1 p-6">
        <Link href="/bundles/moving" className="max-w-4xl mx-auto mb-4 flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-gradient-to-r from-primary/15 to-transparent p-5 hover:border-primary">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Bundle</p>
            <h2 className="text-lg font-semibold">Moving house? Tempo + helpers + cleaning in one go</h2>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
        </Link>
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map((cat) => (
            <Link 
              key={cat.id} 
              href={`/categories/${cat.id}`}
              className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 hover:bg-primary/5 transition-all group flex flex-col items-start gap-4"
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <cat.icon className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-1 group-hover:text-primary transition-colors">{t(`cat.${cat.id}` as "cat.services")}</h3>
                <p className="text-sm text-muted-foreground">{cat.description}</p>
              </div>
              <div className="mt-auto flex items-center text-xs font-medium text-primary uppercase tracking-wider">
                Browse {cat.name} <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
