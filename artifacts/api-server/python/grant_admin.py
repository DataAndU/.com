"""Explicit operator-only admin grant/revoke helper (by sign-in email)."""
import argparse

from sqlalchemy import func, select

from deps import SessionLocal
from models import User

parser = argparse.ArgumentParser()
parser.add_argument("email", help="The user's Google sign-in email")
parser.add_argument("--revoke", action="store_true")
args = parser.parse_args()
if SessionLocal is None:
    raise SystemExit("DATABASE_URL is not configured")
with SessionLocal.begin() as db:
    users = list(db.scalars(select(User).where(
        func.lower(User.email) == args.email.strip().lower()).with_for_update()))
    if len(users) != 1:
        raise SystemExit("User not found (or ambiguous); they must sign in once before an operator can grant admin")
    users[0].is_admin = not args.revoke
print("Admin revoked" if args.revoke else "Admin granted")
