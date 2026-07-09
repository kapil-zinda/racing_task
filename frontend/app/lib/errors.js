// Shared error-copy formatter — never surface raw backend/fetch strings
// (e.g. "Extras API failed: 500", "NotAllowedError: Permission denied") to a
// user mid-study-session. Callers that need to say *what* failed keep their
// own plain-English prefix in the surrounding message; this only replaces
// the raw technical detail.
export function isNetworkError(err) {
  const msg = (err && err.message) || "";
  return err instanceof TypeError || /fetch|network|load failed/i.test(msg);
}

export function friendlyApiError(err) {
  if (isNetworkError(err)) {
    return "Something went wrong on our side — please try again.";
  }
  const msg = (err && err.message) || "";
  if (/\b(4\d\d|5\d\d)\b/.test(msg)) {
    return "We couldn't save that just now — please try again in a moment.";
  }
  return "Something went wrong — please try again.";
}

// Auth flows keep their own domain-specific copy (expired code, account
// already exists, etc.) but share the network-error check and final fallback.
export function friendlyAuthError(err, fallback) {
  if (isNetworkError(err)) {
    return "Something went wrong on our side — please try again.";
  }
  return fallback;
}
