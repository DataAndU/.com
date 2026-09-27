"""Opaque, stable keyset pagination for timestamped UUID/string rows."""
import base64
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_


def _aware(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def encode_cursor(timestamp, row_id):
    payload = json.dumps(
        {"t": _aware(timestamp).isoformat(), "i": str(row_id)},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor):
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if set(payload) != {"t", "i"} or not isinstance(payload["i"], str) or not payload["i"]:
            raise ValueError
        timestamp = datetime.fromisoformat(payload["t"])
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, payload["i"]
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(422, "Invalid pagination cursor") from exc


def keyset_page(db, statement, timestamp_column, id_column, limit, cursor=None, descending=True):
    """Return `(rows, next_cursor)` using `(timestamp, id)` as a unique order key."""
    if cursor:
        timestamp, row_id = decode_cursor(cursor)
        if descending:
            statement = statement.where(or_(
                timestamp_column < timestamp,
                and_(timestamp_column == timestamp, id_column < row_id),
            ))
        else:
            statement = statement.where(or_(
                timestamp_column > timestamp,
                and_(timestamp_column == timestamp, id_column > row_id),
            ))
    ordering = (timestamp_column.desc(), id_column.desc()) if descending else (
        timestamp_column.asc(), id_column.asc())
    rows = list(db.scalars(statement.order_by(*ordering).limit(limit + 1)))
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = encode_cursor(
        getattr(page[-1], timestamp_column.key),
        getattr(page[-1], id_column.key),
    ) if has_more else None
    return page, next_cursor