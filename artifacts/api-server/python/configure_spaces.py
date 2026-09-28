"""One-time Spaces setup: allow browser uploads from Pontreol's origin (CORS) and
confirm the Space is private. Safe to re-run. Prints no secrets.

Usage (App Platform: api component -> Console tab):
    python python/configure_spaces.py
"""
import os
import sys

import spaces

PUBLIC_GRANTEE = "http://acs.amazonaws.com/groups/global/AllUsers"


def origins():
    values = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",")]
    return [o for o in values if o.startswith("https://") or o.startswith("http://localhost")]


def main():
    try:
        _, _, bucket, region, _ = spaces.settings()
    except spaces.StorageNotConfigured as exc:
        raise SystemExit(f"Spaces is not configured: {exc}")
    allowed = origins()
    if not allowed:
        raise SystemExit("ALLOWED_ORIGINS has no https origin")
    client = spaces.make_client()
    try:
        client.head_bucket(Bucket=bucket)
    except spaces.StorageErrors as exc:
        status = getattr(exc, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 404:
            raise SystemExit(
                f"No Space named '{bucket}' was found in region '{region}'.\n"
                "Check Spaces Object Storage in DigitalOcean: set SPACES_BUCKET to the Space's exact "
                "name and SPACES_REGION to its region code (e.g. blr1, sgp1), then redeploy.")
        if status in (401, 403):
            raise SystemExit(
                f"The Spaces key was refused for '{bucket}'. Check SPACES_KEY / SPACES_SECRET and that "
                "the key has Read/Write/Delete access to this Space.")
        raise SystemExit(f"Could not reach the Space '{bucket}' ({type(exc).__name__}).")
    try:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
            "AllowedOrigins": allowed,
            "AllowedMethods": ["PUT", "GET", "HEAD"],
            "AllowedHeaders": ["Content-Type"],
            "MaxAgeSeconds": 3600,
        }]})
    except spaces.StorageErrors as exc:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if code in ("AccessDenied", "403"):
            print("This (limited) Spaces key may not change Space settings - that is fine and safer.\n"
                  "Add the upload rule once in DigitalOcean instead:\n"
                  f"  Spaces Object Storage -> {bucket} -> Settings -> CORS Configurations -> Add\n"
                  f"  Origin: {allowed[0]}   Allowed methods: PUT, GET, HEAD\n"
                  "  Allowed header: Content-Type   Access Control Max Age: 3600")
            return 0
        raise SystemExit(f"Could not set CORS on '{bucket}' ({code or type(exc).__name__}).")
    try:
        acl = client.get_bucket_acl(Bucket=bucket)
    except spaces.StorageErrors:
        print(f"Space '{bucket}' ({region}): browser uploads allowed from {', '.join(allowed)}")
        return 0
    public = any(g.get("Grantee", {}).get("URI") == PUBLIC_GRANTEE for g in acl.get("Grants", []))
    print(f"Space '{bucket}' ({region}): browser uploads allowed from {', '.join(allowed)}")
    if public:
        print("WARNING: this Space allows public listing/reading. In DigitalOcean set "
              "Spaces -> the Space -> Settings -> File Listing to Restricted.")
        return 1
    print("Space is private: photos are only reachable through Pontreol's signed links.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
