"use client";

import { ListingPhoto } from "@/components/listing-photo";
import { Listing, Media } from "@/lib/api/client";
import { uploadMedia } from "@/lib/api/listings";
import { Upload, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { AddressSearch, GeocodedLocation } from "./address-search";

export type Category = Listing["category"];
type PricingMode = Listing["pricingMode"];
type Status = Listing["status"];

export type ListingFormPayload = {
  category: Category;
  title: string;
  description: string;
  price: number;
  pricingMode: PricingMode;
  locationLabel: string;
  latitude: number;
  longitude: number;
  attributes: Record<string, string | number | boolean>;
  photoIds: string[];
  status?: Status;
};

type Props = {
  initial?: Listing;
  defaultCategory?: Category;
  mutationPending: boolean;
  onSubmit: (payload: ListingFormPayload) => Promise<void>;
  onCancel: () => void;
};

const fieldClass = "w-full bg-input border border-border rounded-lg px-3 py-2";

function localDateTime(iso: unknown) {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ListingForm({ initial, defaultCategory, mutationPending, onSubmit, onCancel }: Props) {
  const editing = Boolean(initial);
  const initialAttributes = initial?.attributes ?? {};
  const hydratedAttributes =
    initial?.category === "travel" || (initial?.category === "delivery" && initialAttributes.originLabel)
      ? {
          ...initialAttributes,
          origin: {
            label: String(initialAttributes.originLabel),
            latitude: Number(initialAttributes.originLatitude),
            longitude: Number(initialAttributes.originLongitude),
          },
          destination: {
            label: String(initialAttributes.destinationLabel),
            latitude: Number(initialAttributes.destinationLatitude),
            longitude: Number(initialAttributes.destinationLongitude),
          },
          ...(initial?.category === "travel" ? { departureAt: localDateTime(initialAttributes.departureAt) } : {}),
        }
      : initialAttributes;
  const [category, setCategory] = useState<Category>(initial?.category ?? defaultCategory ?? "services");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [pricingMode, setPricingMode] = useState<PricingMode>(initial?.pricingMode ?? "fixed");
  const [status, setStatus] = useState<Status>(initial?.status ?? "active");
  const [location, setLocation] = useState<GeocodedLocation | null>(
    initial && !(initial.latitude === 0 && initial.longitude === 0)
      ? {
          label: initial.locationLabel,
          latitude: initial.latitude,
          longitude: initial.longitude,
        }
      : null,
  );
  const [attributes, setAttributes] = useState<Record<string, unknown>>(hydratedAttributes);
  const [photos, setPhotos] = useState<Media[]>(initial?.photos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const setAttribute = (key: string, value: string | boolean) => {
    setAttributes((current) => ({ ...current, [key]: value }));
  };

  const selectFiles = (selected: File[]) => {
    setError("");
    if (photos.length + selected.length > 6) {
      setError("A listing can have at most 6 photos.");
      return;
    }
    const invalid = selected.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 2 * 1024 * 1024,
    );
    if (invalid) {
      setError(
        `${invalid.name} must be a JPEG, PNG, or WebP image no larger than 2 MiB.`,
      );
      return;
    }
    setFiles(selected);
  };

  const numberAttribute = (key: string, minimum: number, integer = false) => {
    const raw = String(attributes[key] ?? "");
    if (raw.trim() === "") throw new Error("Complete every category-specific field.");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
      throw new Error(`${key} must be ${integer ? "a whole number" : "a number"} of at least ${minimum}.`);
    }
    return value;
  };

  const buildAttributes = (): ListingFormPayload["attributes"] => {
    const requiredText = (key: string) => {
      const value = String(attributes[key] ?? "").trim();
      if (!value) throw new Error("Complete every category-specific field.");
      return value;
    };
    if (category === "services") {
      return {
        serviceType: requiredText("serviceType"),
        experienceYears: numberAttribute("experienceYears", 0, true),
        onSiteOrRemote: requiredText("onSiteOrRemote"),
      };
    }
    if (category === "spaces") {
      return {
        capacity: numberAttribute("capacity", 1, true),
        spaceType: requiredText("spaceType"),
      };
    }
    if (category === "equipment") {
      return {
        equipmentType: requiredText("equipmentType"),
        condition: requiredText("condition"),
        fuelType: requiredText("fuelType"),
      };
    }
    if (category === "delivery") {
      const from = attributes.origin as GeocodedLocation | null | undefined;
      const to = attributes.destination as GeocodedLocation | null | undefined;
      if (Boolean(from) !== Boolean(to)) throw new Error("Select both the From and To addresses, or leave both empty.");
      return {
        vehicleType: requiredText("vehicleType"),
        maxLoadCapacity: numberAttribute("maxLoadCapacity", 0),
        serviceRadiusKm: numberAttribute("serviceRadiusKm", 0),
        ...(from && to
          ? {
              originLabel: from.label, originLatitude: from.latitude, originLongitude: from.longitude,
              destinationLabel: to.label, destinationLatitude: to.latitude, destinationLongitude: to.longitude,
            }
          : {}),
      };
    }
    const origin = attributes.origin as GeocodedLocation | undefined;
    const destination = attributes.destination as GeocodedLocation | undefined;
    if (!origin || !destination) {
      throw new Error("Search for and select both travel addresses.");
    }
    const departureInput = requiredText("departureAt");
    const departure = new Date(departureInput);
    if (Number.isNaN(departure.getTime())) throw new Error("Enter a valid departure date and time.");
    if (departure.getTime() <= Date.now()) throw new Error("Departure must be in the future.");
    const hasValidCoordinates = (point: GeocodedLocation) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      !(point.latitude === 0 && point.longitude === 0);
    if (!hasValidCoordinates(origin) || !hasValidCoordinates(destination)) {
      throw new Error("Search again and select valid origin and destination addresses.");
    }
    const seatingCapacity = numberAttribute("seatingCapacity", 1, true);
    const availableSeats = numberAttribute("availableSeats", 0, true);
    if (availableSeats > seatingCapacity) {
      throw new Error("Available seats cannot exceed seating capacity.");
    }
    return {
      vehicleType: requiredText("vehicleType"),
      seatingCapacity,
      withDriver: attributes.withDriver === true,
      originLabel: origin.label,
      originLatitude: origin.latitude,
      originLongitude: origin.longitude,
      destinationLabel: destination.label,
      destinationLatitude: destination.latitude,
      destinationLongitude: destination.longitude,
      departureAt: departure.toISOString(),
      availableSeats,
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      if (!location) throw new Error("Search for an address or use GPS to confirm the listing location.");
      if (
        !Number.isFinite(location.latitude) ||
        !Number.isFinite(location.longitude) ||
        (location.latitude === 0 && location.longitude === 0)
      ) {
        throw new Error("Search again or use GPS to confirm a valid listing location.");
      }
      const numericPrice = Number(price);
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        throw new Error("Price must be a valid non-negative amount.");
      }
      const categoryAttributes = buildAttributes();
      setUploading(files.length > 0);
      // Independent uploads run concurrently; Promise.all preserves photo order.
      const uploaded: Media[] = await Promise.all(files.map((file) => uploadMedia(file, "listingPhoto")));
      await onSubmit({
        category,
        title: title.trim(),
        description: description.trim(),
        price: numericPrice,
        pricingMode,
        locationLabel: location.label,
        latitude: location.latitude,
        longitude: location.longitude,
        attributes: categoryAttributes,
        photoIds: [...photos, ...uploaded].map((photo) => photo.id),
        ...(editing ? { status } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The listing could not be saved.");
    } finally {
      setUploading(false);
    }
  };

  const input = (
    key: string,
    label: string,
    options: { type?: string; min?: number; step?: string } = {},
  ) => (
    <label className="block text-sm font-medium">
      {label}
      <input
        required
        type={options.type ?? "text"}
        min={options.min}
        step={options.step}
        value={String(attributes[key] ?? "")}
        onChange={(event) => setAttribute(key, event.target.value)}
        className={`${fieldClass} mt-1`}
      />
    </label>
  );

  const categoryFields = () => {
    if (category === "services") {
      return (
        <>
          {input("serviceType", "Service type")}
          {input("experienceYears", "Experience (years)", { type: "number", min: 0, step: "1" })}
          <label className="block text-sm font-medium">
            Delivery method
            <select required value={String(attributes.onSiteOrRemote ?? "")} onChange={(e) => setAttribute("onSiteOrRemote", e.target.value)} className={`${fieldClass} mt-1`}>
              <option value="" disabled>Select a delivery method</option>
              <option value="onSite">On-site</option>
              <option value="remote">Remote</option>
              <option value="both">On-site and remote</option>
            </select>
          </label>
        </>
      );
    }
    if (category === "spaces") {
      return <>{input("spaceType", "Space type")}{input("capacity", "Capacity (people)", { type: "number", min: 1, step: "1" })}</>;
    }
    if (category === "equipment") {
      return <>{input("equipmentType", "Equipment type")}{input("condition", "Condition")}{input("fuelType", "Fuel or power type")}</>;
    }
    if (category === "delivery") {
      return (
        <>
          {input("vehicleType", "Vehicle type")}
          {input("maxLoadCapacity", "Maximum load (kg)", { type: "number", min: 0, step: "any" })}
          {input("serviceRadiusKm", "Service radius (km)", { type: "number", min: 0, step: "any" })}
          <p className="text-xs text-muted-foreground">Optional: a regular route. Customers are matched when their pickup is near From and drop-off near To (within the service radius).</p>
          <AddressSearch label="From (origin)" allowGps={false} value={(attributes.origin as GeocodedLocation) ?? null}
            onChange={(value) => setAttributes((current) => ({ ...current, origin: value }))} />
          <AddressSearch label="To (destination)" allowGps={false} value={(attributes.destination as GeocodedLocation) ?? null}
            onChange={(value) => setAttributes((current) => ({ ...current, destination: value }))} />
        </>
      );
    }
    const initialAttrs = initial?.category === "travel" ? initial.attributes : {};
    return (
      <>
        {input("vehicleType", "Vehicle type")}
        {input("seatingCapacity", "Seating capacity", { type: "number", min: 1, step: "1" })}
        {input("availableSeats", "Available seats", { type: "number", min: 0, step: "1" })}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={attributes.withDriver === true} onChange={(e) => setAttribute("withDriver", e.target.checked)} />
          Driver included
        </label>
        <AddressSearch
          label="Origin address"
          allowGps={false}
          value={(attributes.origin as GeocodedLocation) ?? (initialAttrs.originLabel ? { label: String(initialAttrs.originLabel), latitude: Number(initialAttrs.originLatitude), longitude: Number(initialAttrs.originLongitude) } : null)}
          onChange={(value) => setAttributes((current) => ({ ...current, origin: value }))}
        />
        <AddressSearch
          label="Destination address"
          allowGps={false}
          value={(attributes.destination as GeocodedLocation) ?? (initialAttrs.destinationLabel ? { label: String(initialAttrs.destinationLabel), latitude: Number(initialAttrs.destinationLatitude), longitude: Number(initialAttrs.destinationLongitude) } : null)}
          onChange={(value) => setAttributes((current) => ({ ...current, destination: value }))}
        />
        <label className="block text-sm font-medium">
          Departure date and time
          <input
            required
            type="datetime-local"
            value={String(attributes.departureAt ?? localDateTime(initialAttrs.departureAt))}
            onChange={(event) => setAttribute("departureAt", event.target.value)}
            className={`${fieldClass} mt-1`}
          />
          <span className="block mt-1 text-xs text-muted-foreground">
            Entered in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}); saved with its UTC offset.
          </span>
        </label>
      </>
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm font-medium">
          Category
          <select
            value={category}
            disabled={editing || !!defaultCategory}
            onChange={(event) => {
              setCategory(event.target.value as Category);
              setAttributes({});
            }}
            className={`${fieldClass} mt-1 disabled:opacity-60`}
          >
            <option value="services">Services</option>
            <option value="spaces">Spaces</option>
            <option value="delivery">Delivery</option>
            <option value="travel">Travel</option>
          </select>
        </label>
        {editing && (
          <label className="block text-sm font-medium">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={`${fieldClass} mt-1`}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        )}
      </div>
      <label className="block text-sm font-medium">
        Title
        <input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={`${fieldClass} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        Description
        <textarea required minLength={10} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${fieldClass} mt-1 h-28`} />
      </label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm font-medium">
          Price (INR)
          <input required type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} className={`${fieldClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium">
          Pricing mode
          <select value={pricingMode} onChange={(e) => setPricingMode(e.target.value as PricingMode)} className={`${fieldClass} mt-1`}>
            <option value="fixed">Fixed</option>
            <option value="negotiable">Negotiable</option>
          </select>
        </label>
      </div>
      <AddressSearch label="Listing address" value={location} onChange={setLocation} />
      <section className="border border-border rounded-xl p-4 space-y-4">
        <h3 className="font-semibold">Category details</h3>
        {categoryFields()}
      </section>
      <section>
        <label className="block text-sm font-medium mb-2">Photos (up to 6, 2 MiB each)</label>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="aspect-square bg-input rounded-lg relative overflow-hidden group">
              <ListingPhoto photo={photo} className="w-full h-full object-cover" alt="Listing photo" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {files.map((file) => (
            <div key={`${file.name}:${file.lastModified}`} className="aspect-square bg-input rounded-lg flex items-center justify-center p-2 text-center text-[10px] break-all">
              {file.name}
            </div>
          ))}
          {photos.length + files.length < 6 && (
            <label className="aspect-square border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Choose</span>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => selectFiles(Array.from(e.target.files ?? []))} className="hidden" />
            </label>
          )}
        </div>
        {files.length > 0 && <button type="button" onClick={() => setFiles([])} className="mt-2 text-xs text-muted-foreground underline">Clear newly selected photos</button>}
      </section>
      {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={uploading || mutationPending} className="px-4 py-2 border border-border rounded-lg disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={uploading || mutationPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50">
          {uploading ? "Uploading photos…" : mutationPending ? "Saving…" : editing ? "Update listing" : "Publish listing"}
        </button>
      </div>
    </form>
  );
}