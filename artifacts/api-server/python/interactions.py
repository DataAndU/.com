from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from billing import free_contact_limit, is_paid
from common import iso, provider_json
from deps import current_user, get_db, require_role
from models import (Booking, ContactUsage, Conversation, Listing, Message,
                    Notification, NotificationOutbox, NotificationPreference,
                    Review, User)
from pagination import keyset_page

router = APIRouter()


def usage(db, user):
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    used = db.scalar(select(func.count(ContactUsage.id)).where(
        ContactUsage.buyer_id == user.id, ContactUsage.period == period)) or 0
    paid, limit = is_paid(db, user.id), free_contact_limit(db)
    return {"period": period, "used": used, "limit": limit, "paid": paid,
            "remaining": None if paid else max(0, limit-used)}


def qualify(db, buyer, listing):
    if buyer.role != "buyer":
        raise HTTPException(403, "Buyer role required")
    state = usage(db, buyer)
    period = state["period"]
    existing = db.scalar(select(ContactUsage).where(
        ContactUsage.buyer_id == buyer.id, ContactUsage.provider_id == listing.provider_id,
        ContactUsage.listing_id == listing.id, ContactUsage.period == period))
    if not existing:
        if not state["paid"]:
            # Lock user serializes limit checks even when two distinct listings race.
            db.scalar(select(User).where(User.id == buyer.id).with_for_update())
            state = usage(db, buyer)
            if state["used"] >= state["limit"]:
                raise HTTPException(402, "Monthly free contact limit reached")
        db.add(ContactUsage(buyer_id=buyer.id, provider_id=listing.provider_id,
                            listing_id=listing.id, period=period))
        listing.contact_count += 1
        db.flush()
    return usage(db, buyer)


@router.get("/contact-usage")
def contact_usage(db: Session = Depends(get_db), user=Depends(current_user)):
    return usage(db, user)


@router.post("/listings/{listing_id}/contact")
def contact(listing_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    listing = db.scalar(select(Listing).where(Listing.id == listing_id).with_for_update())
    if not listing or listing.status != "active": raise HTTPException(404, "Listing not found")
    state = qualify(db, user, listing)
    return {"provider": provider_json(db.get(User, listing.provider_id), True), "usage": state}


class ConversationBody(BaseModel):
    listingId: str
    providerId: str
    initialMessage: str = Field(min_length=1, max_length=4000)


def conversation_json(db, c, viewer):
    last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.created_at.desc()).limit(1))
    return dict(id=c.id, listingId=c.listing_id, buyerId=c.buyer_id, providerId=c.provider_id,
                lastMessageAt=iso(c.last_message_at), lastMessagePreview=last.text[:120] if last else "",
                unreadCount=0, createdAt=iso(c.created_at))


def message_json(m):
    return dict(id=m.id, conversationId=m.conversation_id, senderId=m.sender_id,
                text=m.text, createdAt=iso(m.created_at))


@router.post("/conversations", status_code=201)
def create_conversation(body: ConversationBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    listing = db.scalar(select(Listing).where(Listing.id == body.listingId).with_for_update())
    if not listing or listing.provider_id != body.providerId or listing.status != "active":
        raise HTTPException(404, "Listing not found")
    state = qualify(db, user, listing)
    convo = db.scalar(select(Conversation).where(Conversation.listing_id == listing.id,
        Conversation.buyer_id == user.id, Conversation.provider_id == listing.provider_id))
    if not convo:
        convo = Conversation(listing_id=listing.id, buyer_id=user.id, provider_id=listing.provider_id)
        db.add(convo); db.flush()
    message = Message(conversation_id=convo.id, sender_id=user.id, text=body.initialMessage)
    db.add(message); convo.last_message_at = datetime.now(timezone.utc); db.flush()
    return {"conversation": conversation_json(db, convo, user), "message": message_json(message), "usage": state}


def get_convo(db, conversation_id, user):
    convo = db.get(Conversation, conversation_id)
    if not convo or user.id not in {convo.buyer_id, convo.provider_id}:
        raise HTTPException(404, "Conversation not found")
    return convo


@router.get("/conversations")
def conversations(cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
                  db: Session = Depends(get_db), user=Depends(current_user)):
    stmt = select(Conversation).where(or_(
        Conversation.buyer_id == user.id, Conversation.provider_id == user.id))
    rows, next_cursor = keyset_page(db, stmt, Conversation.last_message_at,
                                    Conversation.id, limit, cursor)
    return {"items": [conversation_json(db, x, user) for x in rows],
            "nextCursor": next_cursor}


@router.get("/conversations/{conversation_id}/messages")
def messages(conversation_id: str, after: datetime | None = None,
             db: Session = Depends(get_db), user=Depends(current_user)):
    convo = get_convo(db, conversation_id, user)
    stmt = select(Message).where(Message.conversation_id == convo.id)
    if after: stmt = stmt.where(Message.created_at > after)
    rows = list(db.scalars(stmt.order_by(Message.created_at).limit(200)))
    return {"messages": [message_json(x) for x in rows],
            "nextAfter": iso(rows[-1].created_at) if rows else iso(after)}


class MessageBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/conversations/{conversation_id}/messages", status_code=201)
def send_message(conversation_id: str, body: MessageBody,
                 db: Session = Depends(get_db), user=Depends(current_user)):
    convo = get_convo(db, conversation_id, user)
    message = Message(conversation_id=convo.id, sender_id=user.id, text=body.text)
    db.add(message); convo.last_message_at = datetime.now(timezone.utc); db.flush()
    other = convo.provider_id if user.id == convo.buyer_id else convo.buyer_id
    db.add(Notification(user_id=other, type="message", title="New message",
                        body=body.text[:160], resource_type="conversation", resource_id=convo.id))
    recipient = db.get(User, other)
    if recipient:
        db.add(NotificationOutbox(user_id=other, recipient=recipient.email,
            subject="New Pontreol message", body=body.text[:160]))
    return message_json(message)


class ReviewBody(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=2000)


@router.post("/bookings/{booking_id}/reviews", status_code=201)
def review(booking_id: str, body: ReviewBody, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = db.scalar(select(Booking).where(Booking.id == booking_id).with_for_update())
    if not booking or user.id not in {booking.buyer_id, booking.provider_id}:
        raise HTTPException(404, "Booking not found")
    if booking.status != "completed" or not booking.buyer_completed_at or not booking.provider_completed_at:
        raise HTTPException(409, "Reviews require mutual completion")
    if db.scalar(select(Review.id).where(Review.booking_id == booking.id, Review.author_id == user.id)):
        raise HTTPException(409, "You already reviewed this booking")
    subject_id = booking.provider_id if user.id == booking.buyer_id else booking.buyer_id
    record = Review(booking_id=booking.id, author_id=user.id, subject_id=subject_id,
                    rating=body.rating, comment=body.comment)
    db.add(record); db.flush()
    target = db.scalar(select(User).where(User.id == subject_id).with_for_update())
    total, count = db.execute(select(func.sum(Review.rating), func.count(Review.id)).where(
        Review.subject_id == subject_id)).one()
    target.rating, target.review_count = float(total or 0)/(count or 1), count
    return {"id": record.id, "bookingId": record.booking_id, "authorId": record.author_id,
            "subjectId": record.subject_id, "rating": record.rating,
            "comment": record.comment, "createdAt": iso(record.created_at)}


def preference_json(x):
    return dict(emailBookings=x.email_bookings, emailMessages=x.email_messages,
                browserBookings=x.browser_bookings, browserMessages=x.browser_messages)


class PreferenceBody(BaseModel):
    emailBookings: bool
    emailMessages: bool
    browserBookings: bool
    browserMessages: bool


@router.get("/notification-preferences")
def preferences(db: Session = Depends(get_db), user=Depends(current_user)):
    pref = db.get(NotificationPreference, user.id)
    if not pref:
        pref = NotificationPreference(user_id=user.id); db.add(pref); db.flush()
    return preference_json(pref)


@router.put("/notification-preferences")
def save_preferences(body: PreferenceBody, db: Session = Depends(get_db), user=Depends(current_user)):
    pref = db.get(NotificationPreference, user.id) or NotificationPreference(user_id=user.id)
    pref.email_bookings, pref.email_messages = body.emailBookings, body.emailMessages
    pref.browser_bookings, pref.browser_messages = body.browserBookings, body.browserMessages
    db.add(pref); db.flush()
    return preference_json(pref)


@router.get("/notifications")
def notifications(cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
                  db: Session = Depends(get_db), user=Depends(current_user)):
    stmt = select(Notification).where(Notification.user_id == user.id)
    rows, next_cursor = keyset_page(db, stmt, Notification.created_at,
                                    Notification.id, limit, cursor)
    return {"items": [dict(id=x.id, type=x.type, title=x.title, body=x.body,
        resourceType=x.resource_type, resourceId=x.resource_id, readAt=iso(x.read_at),
        createdAt=iso(x.created_at)) for x in rows], "nextCursor": next_cursor}


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    item = db.get(Notification, notification_id)
    if not item or item.user_id != user.id: raise HTTPException(404, "Notification not found")
    item.read_at = datetime.now(timezone.utc)
    return {"notification": {"id": item.id, "readAt": iso(item.read_at)}}