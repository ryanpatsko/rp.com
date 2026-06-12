# health-bloodwork Lambda (Phase 2 — pending)

MyFunctionHealth has no export API. This scraper will use **Playwright** in a **Lambda container image** to log in and extract biomarkers.

## Status

Not implemented yet. The dashboard **Refresh Blood Work** button returns a clear error until this is deployed and `HEALTH_BLOODWORK_FUNCTION` is set on **health-api**.

## Planned setup

1. Container image with Node + Playwright Chromium.
2. Credentials in Secrets Manager secret `health/myfunctionhealth`: `{ "email": "...", "password": "..." }`.
3. Writes `health/bloodwork/latest.json` to `rp-health-data`.
4. **health-api** invokes via `HEALTH_BLOODWORK_FUNCTION=health-bloodwork`.

We can implement this once training + Garmin sync are stable.
