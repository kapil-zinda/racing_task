"""Dedicated answer-evaluation worker Lambda.

Deployed as a SEPARATE Lambda function from the API (`lambda_function.py`) so the
API stays lightweight. It is triggered by S3 `ObjectCreated` events on the answer-
eval bucket: it maps the uploaded PDF to its evaluation record, marks it in_process,
runs OCR + LLM marking, writes the marked PDF back, and marks it completed/failed.

Lambda handler: `answer_eval_worker.lambda_handler`
Trigger: S3 → ObjectCreated (prefix `answer-evaluations/`, suffix `original.pdf`)
Uses the same code package + dependency layer as the API function.
"""

import urllib.parse


def lambda_handler(event, context):
    # Imported lazily so this worker's cold start doesn't pull in the FastAPI app.
    from race_api.answer_eval_domain import evaluate_from_object_key

    results = []
    for rec in (event or {}).get("Records", []) or []:
        s3 = rec.get("s3") or {}
        bucket = (s3.get("bucket") or {}).get("name", "")
        key = urllib.parse.unquote_plus((s3.get("object") or {}).get("key", ""))
        try:
            results.append(evaluate_from_object_key(bucket, key))
        except Exception as err:  # noqa: BLE001 — never fail the whole batch on one object
            results.append({"key": key, "error": str(err)})
    return {"processed": len(results), "results": results}
