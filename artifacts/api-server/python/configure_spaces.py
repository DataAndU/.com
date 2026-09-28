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
    client.head_bucket(Bucket=bucket)
    client.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": allowed,
        "AllowedMethods": ["PUT", "GET", "HEAD"],
        "AllowedHeaders": ["Content-Type"],
        "MaxAgeSeconds": 3600,
    }]})
    acl = client.get_bucket_acl(Bucket=bucket)
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
