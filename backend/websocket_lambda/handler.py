from typing import Any, Dict


def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    # EventBridge schedule: {"task": "broadcast_tick"} (rate(1 minute)) — not an
    # API Gateway WebSocket event, so it's routed separately, mirroring the
    # {"task": ...} dispatch convention used by the main REST lambda_function.py.
    if isinstance(event, dict) and event.get("task") == "broadcast_tick":
        from broadcast import run_broadcast_tick

        return run_broadcast_tick()

    from connections import handle_connect, handle_default, handle_disconnect

    route_key = (event.get("requestContext") or {}).get("routeKey")
    if route_key == "$connect":
        return handle_connect(event)
    if route_key == "$disconnect":
        return handle_disconnect(event)
    return handle_default(event)
