// Instant route-transition fallback. Because this boundary exists, Next can
// prefetch it for dynamic routes and show it immediately on navigation while
// the page's server payload streams in (the sidebar layout stays mounted).
export default function AppLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background" role="status" aria-label="Loading">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}
