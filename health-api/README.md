# health-api Lambda

Personal health dashboard API for `/health` on ryanpatsko.com.

## Environment variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `HEALTH_BUCKET` | `rp-health-data` | S3 bucket for all health JSON |
| `HEALTH_PASSWORD` | *(secret)* | Password for login; also HMAC signing secret |

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/health/auth-login` | No | Body `{ "password": "..." }` → `{ "token" }` |
| `GET` | `/health/auth-verify` | Bearer | Returns `{ "ok": true }` if token valid |
| `GET` | `/health/profile` | Bearer | Load profile + `complete` flag |
| `PUT` | `/health/profile` | Bearer | Save profile to `health/profile.json` |
| `GET` | `/health/status` | Bearer | Last-updated timestamps per section |
| `POST` | `/health/scrape-training` | Bearer | Fetch Google Sheets CSV → S3 |
| `POST` | `/health/scrape-garmin` | Bearer | Invoke `health-garmin` Lambda |
| `POST` | `/health/scrape-bloodwork` | Bearer | Invoke bloodwork Lambda (when deployed) |
| `POST` | `/health/scrape-all` | Bearer | All three scrapers |
| `GET` | `/health/data-garmin` | Bearer | Latest Garmin JSON |
| `GET` | `/health/data-training` | Bearer | Latest training JSON |
| `GET` | `/health/data-bloodwork` | Bearer | Latest blood work JSON |

## Deploy

From repo root:

```powershell
cd health-api
npm install
npm run zip
cd ..
```

Upload **`health-api.zip`** to the **health-api** Lambda in AWS Console.

See **`HEALTH-API-GATEWAY-SETUP.md`** for API Gateway routes and AWS setup (S3 bucket, Secrets Manager placeholders).
