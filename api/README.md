# Contest API (Lambda)

Deploy this folder as the Lambda function `contest-api`. Uses the Node 18+ runtime (AWS SDK and `fetch` built-in).

**Deploy:** The Lambda uses `@aws-sdk/client-s3` (Node 18+ doesn’t bundle `aws-sdk`), so you must include `node_modules` in the zip.

From the repo root:

```powershell
cd api
npm install
Compress-Archive -Path index.js, node_modules -DestinationPath ..\contest-api.zip -Force
cd ..
```

macOS/Linux:
```bash
cd api && npm install && zip -r ../contest-api.zip index.js node_modules && cd ..
```

Then upload `contest-api.zip` as the Lambda function code in the AWS Console. Use **Node.js 18.x** or **20.x** runtime.

**Routes (API Gateway must forward to this Lambda):**
- `GET /contests/{contestId}/config` — contest config
- `GET /contests/{contestId}/draft` — draft picks
- `GET /contests/{contestId}/player-pool` — player pool
- `GET /contests/{contestId}/scores` — scoring: pts per player per round (reads from S3 cache; computes and caches if missing)
- `POST /contests/{contestId}/refresh-scores` — recompute scores from BallDontLie and update S3 cache (call from a cron/scheduled task)
- `PUT /contests/{contestId}/draft` — update draft (body: JSON array of picks)
- `POST /contests/{contestId}/import` — run BallDontLie import, write player-pool.json
- `POST /contests/{contestId}/admin-login` — body `{ "password": "..." }`, returns `{ "token": "..." }` if correct
- `GET /contests/{contestId}/admin-verify` — header `Authorization: Bearer <token>`, returns 200 if valid

**Env:** `CONTEST_BUCKET`, `BALLDONTLIE_API_KEY`, `ADMIN_PASSWORD` (for admin login)

**Lambda timeout:** Set to **at least 2 minutes** (e.g. 120 seconds) so the **Import** action can finish (it paginates through all active players).

---

## Test Lambda without API Gateway

To confirm the Lambda and S3/env work before debugging API Gateway:

1. In **AWS Console** → **Lambda** → open **contest-api**.
2. Open the **Test** tab.
3. **Create new event** (or edit existing). Name it e.g. `GetConfig`.
4. Paste the contents of **`api/test-event-get-config.json`** as the event JSON.
5. Click **Test**.

- **If it succeeds:** You get a 200 response and the config JSON. Then the 500 is almost certainly **API Gateway** (integration, response format, or resource policy). Check that API Gateway is allowed to invoke the Lambda (resource policy) and that the integration is “Lambda proxy”.
- **If it fails:** The execution result shows the real error (e.g. missing env, S3 access denied, no such key). Fix that first, then re-test.

**Test the Import (same way):**

1. In the **Test** tab, create (or select) an event.
2. Paste the contents of **`api/test-event-import.json`** (POST to `/contests/2026-1/import`).
3. Click **Test**.

Check the execution result and **CloudWatch logs** (Monitor → View CloudWatch logs) to see which step failed (teams, players, season_stats, build_pool, s3_put) and the exact error.
