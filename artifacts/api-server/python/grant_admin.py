"""Explicit operator-only admin grant/revoke helper."""
import argparse

from sqlalchemy import select

from deps import SessionLocal
from models import User

parser = argparse.ArgumentParser()
parser.add_argument("clerk_user_id")
parser.add_argument("--revoke", action="store_true")
args = parser.parse_args()
if SessionLocal is None:
    raise SystemExit("DATABASE_URL is not configured")
with SessionLocal.begin() as db:
    user = db.scalar(select(User).where(User.clerk_user_id == args.clerk_user_id).with_for_update())
    if not user:
        raise SystemExit("User not found; they must sign in once before an operator can grant admin")
    user.is_admin = not args.revoke
print("Admin revoked" if args.revoke else "Admin granted")