# Scoring and scheduled refresh

## How scoring works

- **GET /contests/{contestId}/scores** — Returns points per player per round. The Lambda reads from S3 (`contests/{contestId}/scores.json`). If that file is missing, it computes scores from the BallDontLie bracket + player_stats API and writes to S3, then returns the result.
- **POST /contests/{contestId}/refresh-scores** — Forces a full recompute from BallDontLie and updates the S3 cache. Use this from a **cron job or scheduled task** during the tournament so scores stay up to date.

## Where it’s called from

- **Contest page (draft board)** — When anyone opens the contest page, the app calls **GET …/scores** and uses the result to show round-by-round points and totals on the Leaderboard tab. No button; it runs on page load and uses the cached data.
- **Cron / scheduled task** — During the tournament, run **POST …/refresh-scores** on a schedule (e.g. every 15–30 minutes). That recomputes scores and updates the cache so the next page load shows fresh data.

## No new API Gateway route

If you already have **GET** and **POST** for `/contests/{proxy+}` pointing at the Lambda, those same routes handle:

- `GET /contests/2026-1/scores`
- `POST /contests/2026-1/refresh-scores`

You do **not** need to add a separate route for scores.

## Setting up a scheduled refresh (AWS)

1. **EventBridge (CloudWatch Events)**  
   - Create a rule (e.g. “Refresh contest scores”).  
   - Schedule: `rate(15 minutes)` or `cron(0/30 * * * ? *)` (every 30 min).  
   - Target: **API Gateway** or **Lambda**.  
   - If target is Lambda: use a small Lambda that calls your API with `POST https://your-api-url/contests/2026-1/refresh-scores` (with the correct contest id and API base URL).  
   - If EventBridge can target HTTP: point it at `POST …/refresh-scores` (some setups use a Lambda that only invokes the HTTP endpoint).

2. **Simpler: Lambda that calls the API**  
   - Create a second Lambda (e.g. `contest-refresh-scores`) that runs on a schedule.  
   - In that Lambda, use `fetch` to call `POST https://xj8k273vj7.execute-api.us-east-1.amazonaws.com/contests/2026-1/refresh-scores`.  
   - Attach an EventBridge schedule to invoke this Lambda every 15–30 minutes during the tournament.

3. **Alternative: external cron**  
   - From a server or cron service (e.g. GitHub Actions, Vercel Cron, or a small server), call `POST …/refresh-scores` on the same schedule.

Replace `2026-1` with your actual contest id if different.
