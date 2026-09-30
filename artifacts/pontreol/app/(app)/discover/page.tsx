"use client";

import { DiscoverBoard } from "@/components/discover-board";

export default function DiscoverPage() {
  return (
    <DiscoverBoard
      headerContent={<h1 className="text-xl font-semibold mb-3">Find help nearby</h1>}
    />
  );
}
