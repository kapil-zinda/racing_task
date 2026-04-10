"""Entrypoint module for local uvicorn and AWS Lambda.

Application logic lives in the `race_api` package.
"""

from race_api import app, handler

__all__ = ["app", "handler"]
