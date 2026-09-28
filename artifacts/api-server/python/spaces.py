"""DigitalOcean Spaces (S3-compatible) object storage for photos and ID images.

Exposes the small object interface media.py uses (blob().generate_signed_url,
reload, size, content_type, delete). The bucket stays private: browsers only
ever receive short-lived presigned URLs; the access keys never leave the API.

Configuration (api component):
  SPACES_KEY, SPACES_SECRET   access key pair (secret: SPACES_SECRET)
  SPACES_BUCKET               Space name, e.g. pontreol-media
  SPACES_REGION               e.g. blr1 (default)
  SPACES_ENDPOINT             optional override, default https://<region>.digitaloceanspaces.com
  SPACES_ADDRESSING_STYLE     optional; "path" only for local S3 test servers
"""
import os

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


class StorageNotConfigured(ValueError):
    """Secret-free description of missing storage configuration."""


def settings():
    key = os.getenv("SPACES_KEY", "").strip()
    secret = os.getenv("SPACES_SECRET", "").strip()
    bucket = os.getenv("SPACES_BUCKET", "").strip()
    region = os.getenv("SPACES_REGION", "blr1").strip() or "blr1"
    endpoint = os.getenv("SPACES_ENDPOINT", "").strip() or f"https://{region}.digitaloceanspaces.com"
    missing = [name for name, value in (("SPACES_KEY", key), ("SPACES_SECRET", secret),
                                        ("SPACES_BUCKET", bucket)) if not value]
    if missing:
        raise StorageNotConfigured("Missing " + ", ".join(missing))
    return key, secret, bucket, region, endpoint


def addressing_style():
    # Spaces recommends virtual-host URLs (bucket.region.digitaloceanspaces.com);
    # "path" exists for S3-compatible test servers.
    return "path" if os.getenv("SPACES_ADDRESSING_STYLE", "").strip() == "path" else "virtual"


def make_client():
    key, secret, _bucket, region, endpoint = settings()
    return boto3.client("s3", region_name=region, endpoint_url=endpoint,
                        aws_access_key_id=key, aws_secret_access_key=secret,
                        config=Config(signature_version="s3v4", s3={"addressing_style": addressing_style()},
                                      connect_timeout=5, read_timeout=15, retries={"max_attempts": 2}))


class SpacesObject:
    def __init__(self, client, bucket, key):
        self._client, self._bucket, self.name = client, bucket, key
        self.size = None
        self.content_type = None

    def generate_signed_url(self, version="v4", expiration=None, method="GET", content_type=None):
        seconds = int(expiration.total_seconds()) if hasattr(expiration, "total_seconds") else int(expiration or 900)
        params = {"Bucket": self._bucket, "Key": self.name}
        if method == "PUT":
            operation = "put_object"
            if content_type:
                params["ContentType"] = content_type  # browser must send the same Content-Type
        elif method == "GET":
            operation = "get_object"
        else:
            raise ValueError("Unsupported signed URL method")
        return self._client.generate_presigned_url(operation, Params=params, ExpiresIn=seconds,
                                                   HttpMethod=method)

    def reload(self):
        """Load size/content type; raises LookupError when the object is missing."""
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=self.name)
        except ClientError as exc:
            raise LookupError("object not found") from exc
        self.size = head.get("ContentLength")
        self.content_type = head.get("ContentType")

    def delete(self):
        self._client.delete_object(Bucket=self._bucket, Key=self.name)


class SpacesBucket:
    def __init__(self, client, name):
        self._client, self.name = client, name

    def blob(self, key):
        return SpacesObject(self._client, self.name, key)


StorageErrors = (BotoCoreError, ClientError)
