from datetime import timezone
from fastapi import HTTPException

from models import ListingMedia, Media, User
from sqlalchemy import select


def iso(value):
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def user_json(user):
    return dict(id=user.id, clerkUserId=user.clerk_user_id, email=user.email,
                displayName=user.display_name, avatarUrl=user.avatar_url, role=user.role,
                isAdmin=user.is_admin, verificationStatus=user.verification_status,
                rating=user.rating, reviewCount=user.review_count,
                contactEmailVisible=user.contact_email_visible,
                contactPhoneVisible=user.contact_phone_visible, phone=user.phone,
                createdAt=iso(user.created_at))


def provider_json(user, reveal=False):
    return dict(id=user.id, displayName=user.display_name, avatarUrl=user.avatar_url,
                verificationStatus=user.verification_status, rating=user.rating,
                reviewCount=user.review_count,
                contactEmail=user.email if reveal and user.contact_email_visible else None,
                contactPhone=user.phone if reveal and user.contact_phone_visible else None)


def media_json(media):
    return dict(id=media.id, objectPath=media.object_path, contentType=media.content_type,
                sizeBytes=media.size_bytes, status=media.status)


def listing_json(db, listing, distance=None):
    provider = db.get(User, listing.provider_id)
    media = list(db.scalars(select(Media).join(ListingMedia).where(
        ListingMedia.listing_id == listing.id).order_by(ListingMedia.position)))
    return _listing_payload(listing, provider, media, distance)


def _listing_payload(listing, provider, media, distance):
    return dict(id=listing.id, providerId=listing.provider_id,
                provider=provider_json(provider), category=listing.category,
                title=listing.title, description=listing.description, price=listing.price,
                pricingMode=listing.pricing_mode, currency=listing.currency,
                locationLabel=listing.location_label, latitude=listing.latitude,
                longitude=listing.longitude, status=listing.status,
                attributes=listing.attributes, photos=[media_json(x) for x in media],
                distanceKm=distance, viewCount=listing.view_count,
                contactCount=listing.contact_count, createdAt=iso(listing.created_at),
                updatedAt=iso(listing.updated_at))


def listings_json(db, rows):
    """Serialize (listing, distance) pairs with one provider and one photo query."""
    rows = list(rows)
    if not rows:
        return []
    listing_ids = [listing.id for listing, _ in rows]
    provider_ids = {listing.provider_id for listing, _ in rows}
    providers = {provider.id: provider for provider in
                 db.scalars(select(User).where(User.id.in_(provider_ids)))}
    photos = {listing_id: [] for listing_id in listing_ids}
    for listing_id, media in db.execute(
            select(ListingMedia.listing_id, Media).join(
                Media, ListingMedia.media_id == Media.id).where(
                ListingMedia.listing_id.in_(listing_ids)).order_by(ListingMedia.position)):
        photos[listing_id].append(media)
    return [_listing_payload(listing, providers[listing.provider_id],
                             photos[listing.id], distance) for listing, distance in rows]


def owned(db, model, object_id, user, owner_field="provider_id"):
    obj = db.get(model, object_id)
    if not obj or getattr(obj, owner_field) != user.id:
        raise HTTPException(404, "Resource not found")
    return obj