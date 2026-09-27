"use client";

import { useState } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { DiscoverBoard } from "@/components/discover-board";
import { ListingForm, ListingFormPayload } from "@/components/listing-form";
import { useMe } from "@/lib/api/account";
import { useCreateListing } from "@/lib/api/listings";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import Link from "next/link";

const VALID_CATEGORIES = ["services", "spaces", "equipment", "delivery", "travel"] as const;
type CategoryId = typeof VALID_CATEGORIES[number];

export default function CategoryPage() {
  const params = useParams();
  const categoryId = params.category as string;
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState<"browse" | "offer">("browse");
  
  const { data: user, isLoading: userLoading } = useMe();
  const createMutation = useCreateListing();

  if (!VALID_CATEGORIES.includes(categoryId as CategoryId)) {
    notFound();
  }

  const categoryName = categoryId.charAt(0).toUpperCase() + categoryId.slice(1);

  const create = async (payload: ListingFormPayload) => {
    const newListing = await createMutation.mutateAsync(payload);
    router.push(`/discover/${newListing.id}`);
  };

  const header = (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Link href="/categories" aria-label="Back to categories" className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold">{categoryName}</h1>
      </div>
      
      <div className="flex bg-input/50 p-1 rounded-lg w-max border border-border">
        <button
          onClick={() => setActiveTab("browse")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
            activeTab === "browse" 
              ? "bg-card text-foreground shadow-sm border border-border/50" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Browse {categoryName}
        </button>
        <button
          onClick={() => setActiveTab("offer")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
            activeTab === "offer" 
              ? "bg-card text-foreground shadow-sm border border-border/50" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Offer / Sell
        </button>
      </div>
    </div>
  );

  if (activeTab === "browse") {
    return (
      <DiscoverBoard 
        key={categoryId}
        fixedCategory={categoryId} 
        headerContent={header}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        {header}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {userLoading ? (
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mt-10" />
          ) : user?.role !== "provider" ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold mb-2">Provider Account Required</h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                You are currently registered as a buyer on Pontreol. To ensure trust and quality in our neighborhood marketplace, offering services or items requires a permanent provider account.
              </p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Account roles cannot be changed. You can browse listings and make requests with this buyer account; only provider accounts can publish offers.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-6">Create {categoryName} Listing</h2>
              <ListingForm 
                key={categoryId}
                defaultCategory={categoryId as CategoryId}
                mutationPending={createMutation.isPending} 
                onSubmit={create} 
                onCancel={() => setActiveTab("browse")} 
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
