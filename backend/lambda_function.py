from app import handler


def lambda_handler(event, context):
    # Async self-invocations (e.g. chunk concatenation) carry a "task" key and are
    # not API Gateway events, so route them to the worker instead of Mangum.
    if isinstance(event, dict) and event.get("task") == "concat_chunks":
        from race_api.session_domain import run_concat_chunks_task

        return run_concat_chunks_task(event)
    # Optional EventBridge schedule: {"task": "reap_stale"} closes abandoned recordings.
    if isinstance(event, dict) and event.get("task") == "reap_stale":
        from race_api.session_domain import reap_stale_sessions

        return reap_stale_sessions()
    if isinstance(event, dict) and event.get("task") == "evaluate_answer":
        from race_api.answer_eval_domain import run_evaluate_answer_task

        return run_evaluate_answer_task(event)
    return handler(event, context)
