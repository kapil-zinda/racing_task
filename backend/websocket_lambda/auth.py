from typing import Optional

from db import users_collection


def resolve_user_id(api_key: str) -> Optional[str]:
    """Same lookup as race_api.auth_service.get_user_by_api_key, duplicated here
    (rather than importing race_api) to keep this Lambda's package independent
    and dependency-light."""
    key = (api_key or "").strip()
    if not key:
        return None
    user = users_collection().find_one({"api_key": key})
    return str(user["_id"]) if user else None
