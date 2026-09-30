"use client";

import { useCallback, useEffect, useState } from "react";

export type Coordinates = { lat: number; lng: number };

export type LocationState =
  | { status: "idle" } // not asked yet: we never prompt without the user asking
  | { status: "locating" }
  | { status: "ready"; coords: Coordinates; source: "gps" | "search" }
  | { status: "denied" }
  | { status: "unavailable"; reason: "unsupported" | "insecure" | "timeout" | "error" };

// Android Chrome may otherwise wait forever (the spec default timeout is
// Infinity) or spin up high-accuracy GPS; a coarse, recent fix is enough for
// a 10 km map and resolves much faster.
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 5 * 60_000,
};
const REUSE_MS = 5 * 60_000;

// Module scope survives client-side navigation, so returning to the map uses
// the last fix immediately (same rounded coordinates => React Query cache hit).
let lastKnown: { state: Extract<LocationState, { status: "ready" }>; at: number } | null = null;

/** ~110 m precision: keeps query keys stable across tiny GPS jitter. */
export function roundCoord(value: number) {
  return Math.round(value * 1000) / 1000;
}

function toCoords(position: GeolocationPosition): Coordinates {
  return { lat: roundCoord(position.coords.latitude), lng: roundCoord(position.coords.longitude) };
}

function failure(error: GeolocationPositionError): LocationState {
  if (error.code === error.PERMISSION_DENIED) return { status: "denied" };
  if (error.code === error.TIMEOUT) return { status: "unavailable", reason: "timeout" };
  return { status: "unavailable", reason: "error" };
}

function initialState(): LocationState {
  if (lastKnown && Date.now() - lastKnown.at < REUSE_MS) return lastKnown.state;
  return { status: "locating" };
}

export function useUserLocation() {
  const [state, setState] = useState<LocationState>(initialState);

  const remember = useCallback((next: LocationState) => {
    if (next.status === "ready") lastKnown = { state: next, at: Date.now() };
    setState(next);
  }, []);

  const locate = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) return setState({ status: "unavailable", reason: "insecure" });
    if (!("geolocation" in navigator)) return setState({ status: "unavailable", reason: "unsupported" });
    setState((current) => (current.status === "ready" ? current : { status: "locating" }));
    navigator.geolocation.getCurrentPosition(
      (position) => remember({ status: "ready", coords: toCoords(position), source: "gps" }),
      (error) => setState((current) =>
        // A failed GPS refresh must not discard a location the user searched for.
        current.status === "ready" && current.source === "search" ? current : failure(error)),
      POSITION_OPTIONS,
    );
  }, [remember]);

  const setSearched = useCallback((coords: Coordinates) => {
    remember({ status: "ready", coords: { lat: roundCoord(coords.lat), lng: roundCoord(coords.lng) }, source: "search" });
  }, [remember]);

  useEffect(() => {
    if (state.status !== "locating") return;
    let cancelled = false;
    // Skip the prompt path entirely when the permission is already blocked.
    const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (permissions?.query) {
      permissions.query({ name: "geolocation" as PermissionName }).then(
        (result) => {
          if (cancelled) return;
          // Use location silently only if the user already allowed it;
          // otherwise wait until they choose "Use my location".
          if (result.state === "denied") setState({ status: "denied" });
          else if (result.state === "granted") locate();
          else setState({ status: "idle" });
        },
        () => { if (!cancelled) setState({ status: "idle" }); },
      );
    } else {
      setState({ status: "idle" });
    }
    return () => { cancelled = true; };
    // Run once on mount; `locate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, locate, setSearched };
}
