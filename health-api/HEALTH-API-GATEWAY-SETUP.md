# Health API — AWS setup (Phase 1)

Use the **same HTTP API** as contests (`https://xj8k273vj7.execute-api.us-east-1.amazonaws.com`), with a **separate Lambda** (`health-api`).

## 1. S3 bucket `rp-health-data`

1. Create bucket **rp-health-data** in **us-east-1**.
2. Block all public access.
3. No objects required yet — profile is created on first save from the app.

## 2. Lambda `health-api`

1. Create function **health-api** (Node.js 20.x), handler **index.handler**.
2. Upload **health-api.zip** from repo root.
3. Environment variables:
   - `HEALTH_BUCKET` = `rp-health-data`
   - `HEALTH_PASSWORD` = your chosen dashboard password
4. IAM role — attach an inline policy with **two statements** (bucket + objects). Object-only `GetObject`/`PutObject` is not enough — the SDK also needs `s3:ListBucket` on the bucket ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HealthBucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::rp-health-data"
    },
    {
      "Sid": "HealthObjectReadWrite",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::rp-health-data/*"
    }
  ]
}
```

If you already added the old one-statement policy, **edit** it to include both statements (or add a second inline policy with the `ListBucket` block). IAM changes apply within seconds — no Lambda redeploy needed.

**Phase 2** — add to the same role:

```json
{
  "Sid": "InvokeGarminWorker",
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:us-east-1:242192367577:function:health-garmin"
}
```

(Replace account ID if different.)

**Phase 2 env vars** on `health-api`:

| Variable | Example | Purpose |
|----------|---------|---------|
| `TRAINING_SHEET_CSV_URL` | `https://docs.google.com/spreadsheets/d/…/export?format=csv&gid=0` | Published training log CSV |
| `HEALTH_GARMIN_FUNCTION` | `health-garmin` | Python Lambda to sync Garmin |
| `HEALTH_BLOODWORK_FUNCTION` | *(optional)* | Playwright scraper when deployed |

See `health-garmin/README.md` for Garmin Lambda deploy.

## 3. API Gateway routes

On the existing HTTP API, **Create route** for each (integration = **health-api** Lambda):

| Method | Route path |
|--------|------------|
| `GET` | `/health/{proxy+}` |
| `PUT` | `/health/{proxy+}` |
| `POST` | `/health/{proxy+}` |

### CORS (required for browser login from localhost)

You do **not** need a Lambda Function URL. CORS is handled on the **HTTP API**, not on the Lambda console.

1. **API Gateway** → your HTTP API (`xj8k273vj7…`) → left sidebar **CORS** → **Configure** / **Edit**.
2. Set:
   - **Access-Control-Allow-Origin**: `*` (or `http://localhost:3000` for dev only)
   - **Access-Control-Allow-Methods**: `GET`, `PUT`, `POST`, `OPTIONS`
   - **Access-Control-Allow-Headers**: `content-type, authorization`
3. **Save**. If you added `/health` routes *after* CORS was first configured, open CORS again and save once more so API Gateway registers OPTIONS for the new paths.

**Also required:** the three `/health/{proxy+}` routes in section 3 must exist and point at **health-api**. A missing route returns 403/404 **without** CORS headers — the browser reports that as a CORS error even though the real problem is “route not found.”

**Quick check** (PowerShell — no browser CORS):

```powershell
Invoke-WebRequest -Uri "https://xj8k273vj7.execute-api.us-east-1.amazonaws.com/health/auth-login" -Method POST -ContentType "application/json" -Body '{"password":"test"}' -UseBasicParsing
```

- **404 / 403** → add or fix API Gateway routes (section 3).
- **401 Invalid password** → routes and Lambda are wired; fix `HEALTH_PASSWORD` or use the correct password in the app.
- **503** → Lambda env vars missing (`HEALTH_PASSWORD`, `HEALTH_BUCKET`).

Contests admin login from `http://localhost:3000` working is a good sign CORS is already fine — then the usual fix is only the `/health/{proxy+}` routes.

## 4. Secrets Manager (placeholders for Phase 2)

Create two secrets (values filled when you wire scrapers):

- `health/myfunctionhealth` — JSON: `{ "email": "...", "password": "..." }`
- `health/garmin` — JSON: `{ "email": "...", "password": "..." }`

Do **not** add these to the repo. Phase 2 Lambda updates will read them via `GetSecretValue`.

## 5. Frontend env

Set in Amplify / Vercel / `.env.local`:

```
REACT_APP_HEALTH_API_URL=https://xj8k273vj7.execute-api.us-east-1.amazonaws.com
```

(Same host as `REACT_APP_CONTEST_API_URL` if you use one API.)

## 6. Smoke test

```text
POST https://YOUR_API/health/auth-login
Body: { "password": "YOUR_PASSWORD" }

GET https://YOUR_API/health/profile
Header: Authorization: Bearer <token>
```

## 7. Phase 2 — Training sheet URL

1. In Google Sheets: **File → Share → Publish to web** → CSV.
2. Copy the export URL (`…/export?format=csv&gid=…`).
3. Set `TRAINING_SHEET_CSV_URL` on **health-api** and redeploy **health-api.zip**.
4. Set Lambda **Timeout** to **30 seconds** (Configuration → General) so the sheet download can finish.
5. In the app, use **Sync Training Log** or **Sync All Data**.

Column headers are matched flexibly (`date`, `workout`, `mileage`, `weekly mileage`, `feel`, etc.).

**Weekly grid format** (Mon–Sun columns + `Sat. Date` + `Miles`): detected automatically. Workout abbreviations (UB, LB, C, HT, RR, etc.) are expanded on sync and stored in `abbreviationLegend` for the dashboard and future AI analysis. Add more in `health-api/scrapers/training-abbreviations.js` and `src/data/trainingAbbreviations.js`.

### `{"message":"Internal Server Error"}` on sync

That response usually means the Lambda **timed out** or **crashed before returning** (not a normal app error). Check **CloudWatch → health-api → Logs** for the real message. Common fixes:

- Increase timeout to **30s**
- Confirm `TRAINING_SHEET_CSV_URL` is the **CSV export** link, not the edit/share link
- Redeploy latest **health-api.zip** (includes `scrapers/training.js`)
