"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { Media } from "@/lib/api/client";

/**
 * Renders a stored listing photo through the authorized same-origin
 * `/api/media/{id}` endpoint. Falls back to a neutral placeholder when the
 * object is missing or storage is temporarily unavailable.
 */
export function ListingPhoto({ photo, className, alt = "", eager = false }: {
  photo: Pick<Media, "id"> & { url?: string };
  className?: string;
  alt?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-input text-muted-foreground" role="img" aria-label="Photo unavailable">
        <ImageOff className="w-8 h-8 opacity-40" />
      </div>
    );
  }
  return (
    <img
      src={photo.url || `/api/media/${encodeURIComponent(photo.id)}`}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
