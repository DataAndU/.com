"""Pontreol relational model. Schema changes are applied explicitly, never at startup."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (Boolean, CheckConstraint, Column, Date, DateTime, Float,
                        ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func, text)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def uid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=uid)
    # Legacy Clerk identity: retained (nullable) for rollback/audit only.
    # Nothing authenticates with it any more (migration 0002).
    clerk_user_id = Column(String(255), nullable=True, unique=True, index=True)
    # Legacy Google sign-in subject: retained for rollback/history only.
    # Sign-in identity is the normalized email (email OTP).
    google_sub = Column(String(255), nullable=True, unique=True, index=True)
    email = Column(String(320), nullable=False)
    display_name = Column(String(120), nullable=False)
    avatar_url = Column(Text)
    role = Column(String(16), CheckConstraint("role IN ('buyer','provider')"))
    is_admin = Column(Boolean, nullable=False, default=False)
    suspended = Column(Boolean, nullable=False, default=False)
    phone = Column(String(40))
    contact_email_visible = Column(Boolean, nullable=False, default=False)
    contact_phone_visible = Column(Boolean, nullable=False, default=False)
    verification_status = Column(String(20), nullable=False, default="notStarted")
    rating = Column(Float, nullable=False, default=0)
    # Provider "Available now" switch; expires automatically (migration 0004).
    available_until = Column(DateTime(timezone=True))
    # Badges (migration 0005): first providers, and reply speed to buyers.
    founding_provider = Column(Boolean, nullable=False, default=False, server_default="false")
    avg_response_minutes = Column(Float)
    response_samples = Column(Integer, nullable=False, default=0, server_default="0")
    # Refer-a-provider (migration 0006).
    referral_code = Column(String(16), unique=True, index=True)
    referred_by = Column(String(36), ForeignKey("users.id"))
    referral_credit_months = Column(Integer, nullable=False, default=0, server_default="0")
    review_count = Column(Integer, nullable=False, default=0)
    # Morning reminder (migration 0011): India date of the last reminder.
    last_reminded_on = Column(Date)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now, onupdate=now)
    __table_args__ = (Index("ix_users_email_lower", func.lower(email)),)


class AuthSession(Base):
    """Opaque server-side login session. Only a SHA-256 hash of the random
    cookie token is stored, so a database leak does not reveal live cookies."""
    __tablename__ = "auth_sessions"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at = Column(DateTime(timezone=True))


class EmailOtpChallenge(Base):
    """One emailed sign-in code. Only a salted scrypt hash of the code is
    stored; single use, short lived, attempt-limited (migration 0003)."""
    __tablename__ = "email_otp_challenges"
    id = Column(String(36), primary_key=True, default=uid)
    email = Column(String(320), nullable=False, index=True)  # normalized
    code_salt = Column(String(32), nullable=False)
    code_hash = Column(String(128), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    ip_hash = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True))


class AuthRateEvent(Base):
    """Failed verifications per client IP (hashed), for rate limiting."""
    __tablename__ = "auth_rate_events"
    id = Column(String(36), primary_key=True, default=uid)
    ip_hash = Column(String(64), nullable=False, index=True)
    kind = Column(String(24), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now, index=True)


class Listing(Base):
    __tablename__ = "listings"
    id = Column(String(36), primary_key=True, default=uid)
    provider_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(20), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    description = Column(Text, nullable=False)
    price = Column(Float, nullable=False)
    pricing_mode = Column(String(20), nullable=False)
    currency = Column(String(3), nullable=False, default="INR")
    location_label = Column(String(300), nullable=False)
    latitude = Column(Float, nullable=False, index=True)
    longitude = Column(Float, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="active", index=True)
    attributes = Column(JSON, nullable=False, default=dict)
    view_count = Column(Integer, nullable=False, default=0)
    contact_count = Column(Integer, nullable=False, default=0)
    # Last-minute deal (migration 0010): percent off until deal_until.
    deal_percent = Column(Integer)
    deal_until = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now, onupdate=now)
    # Bounding-box lookups for /home/summary and /listings (migration 0001).
    __table_args__ = (Index("ix_listings_active_lat_lng", "latitude", "longitude",
                            postgresql_where=text("status = 'active'")),)


class Media(Base):
    __tablename__ = "media"
    id = Column(String(36), primary_key=True, default=uid)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    purpose = Column(String(24), nullable=False)
    object_path = Column(Text, nullable=False, unique=True)
    content_type = Column(String(80), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    is_private = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class ListingMedia(Base):
    __tablename__ = "listing_media"
    listing_id = Column(String(36), ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True)
    media_id = Column(String(36), ForeignKey("media.id"), primary_key=True)
    position = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("listing_id", "position"),)


class Availability(Base):
    __tablename__ = "availability"
    id = Column(String(36), primary_key=True, default=uid)
    listing_id = Column(String(36), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    ends_at = Column(DateTime(timezone=True), nullable=False, index=True)
    timezone = Column(String(80), nullable=False)


class Booking(Base):
    __tablename__ = "bookings"
    id = Column(String(36), primary_key=True, default=uid)
    listing_id = Column(String(36), ForeignKey("listings.id"), nullable=False, index=True)
    buyer_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    provider_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(20), nullable=False, index=True)
    status = Column(String(24), nullable=False, index=True)
    details = Column(JSON, nullable=False, default=dict)
    quoted_price = Column(Float)
    buyer_completed_at = Column(DateTime(timezone=True))
    provider_completed_at = Column(DateTime(timezone=True))
    # "Share my trip" (travel): hashed public token + expiry (migration 0008).
    share_token_hash = Column(String(64), unique=True, index=True)
    share_expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now, onupdate=now)


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String(36), primary_key=True, default=uid)
    listing_id = Column(String(36), ForeignKey("listings.id"), nullable=False)
    buyer_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    provider_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    last_message_at = Column(DateTime(timezone=True), nullable=False, default=now)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("listing_id", "buyer_id", "provider_id"),)


class Message(Base):
    __tablename__ = "messages"
    id = Column(String(36), primary_key=True, default=uid)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now, index=True)
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)


class ContactUsage(Base):
    __tablename__ = "contact_usage"
    id = Column(String(36), primary_key=True, default=uid)
    buyer_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    provider_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    listing_id = Column(String(36), ForeignKey("listings.id"), nullable=False)
    period = Column(String(7), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("buyer_id", "provider_id", "listing_id", "period"),)


class Verification(Base):
    __tablename__ = "verifications"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    legal_name = Column(String(160), nullable=False)
    id_type = Column(String(40), nullable=False)
    id_media_id = Column(String(36), ForeignKey("media.id"), nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    rejection_reason = Column(Text)
    submitted_at = Column(DateTime(timezone=True), nullable=False, default=now)
    reviewed_at = Column(DateTime(timezone=True))
    reviewed_by = Column(String(36), ForeignKey("users.id"))


class Review(Base):
    __tablename__ = "reviews"
    id = Column(String(36), primary_key=True, default=uid)
    booking_id = Column(String(36), ForeignKey("bookings.id"), nullable=False)
    author_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    subject_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)
    comment = Column(Text, nullable=False)
    photo_ids = Column(JSON, nullable=False, default=list, server_default="[]")
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("booking_id", "author_id"),)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(40), nullable=False)
    title = Column(String(160), nullable=False)
    body = Column(Text, nullable=False)
    resource_type = Column(String(40))
    resource_id = Column(String(36))
    read_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at", "id"),)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    email_bookings = Column(Boolean, nullable=False, default=True)
    email_messages = Column(Boolean, nullable=False, default=True)
    browser_bookings = Column(Boolean, nullable=False, default=True)
    browser_messages = Column(Boolean, nullable=False, default=True)
    email_reminders = Column(Boolean, nullable=False, default=True, server_default="true")


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    recipient = Column(String(320), nullable=False)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    sent_at = Column(DateTime(timezone=True))
    last_error = Column(Text)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class SiteBanner(Base):
    """Admin-managed announcement shown on the home map (migration 0007)."""
    __tablename__ = "site_banners"
    id = Column(String(36), primary_key=True, default=uid)
    message = Column(String(200), nullable=False)
    link_path = Column(String(200))
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class SocietyRecommendation(Base):
    """A resident vouches for a helper they have used (migration 0012)."""
    __tablename__ = "society_recommendations"
    id = Column(String(36), primary_key=True, default=uid)
    society_slug = Column(String(80), nullable=False, index=True)
    society_name = Column(String(120), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    provider_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("society_slug", "user_id", "provider_id",
                                       name="uq_society_recommendation"),)


class FreeAlert(Base):
    """ "Notify me when someone is free" (migration 0013). Fires once."""
    __tablename__ = "free_alerts"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(20))
    keyword = Column(String(60))
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class GeocodeCache(Base):
    __tablename__ = "geocode_cache"
    query = Column(String(200), primary_key=True)
    results = Column(JSON, nullable=False)
    fetched_at = Column(DateTime(timezone=True), nullable=False, default=now)


class AuditRecord(Base):
    __tablename__ = "admin_audit"
    id = Column(String(36), primary_key=True, default=uid)
    admin_user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    action = Column(String(80), nullable=False)
    target_type = Column(String(40), nullable=False)
    target_id = Column(String(36), nullable=False)
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)