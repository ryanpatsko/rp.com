# API Gateway setup (HTTP API)

Your Lambda is deployed; API Gateway must **route** requests to it. Follow these steps in the **AWS Console**.

## 1. Open your API

1. Go to **API Gateway** in the AWS Console.
2. Under **APIs**, open your **HTTP API** (the one whose invoke URL is `https://xj8k273vj7.execute-api.us-east-1.amazonaws.com`).
3. In the left sidebar, click **Routes**.

## 2. Create routes that forward to Lambda

You need one route per **method** so that any path under `/contests/...` goes to your Lambda.

For each of these, click **Create route** and fill in:

| Method | Route path      | Purpose                          |
|--------|-----------------|-----------------------------------|
| `GET`  | `/contests/{proxy+}` | Read config, draft, player-pool   |
| `PUT`  | `/contests/{proxy+}` | Update draft                      |
| `POST` | `/contests/{proxy+}` | Run import                        |

- **Method**: choose GET, then create the route. Repeat for PUT, then POST.
- **Path**: type exactly `/contests/{proxy+}` (the `{proxy+}` part is a “greedy” path variable that matches the rest of the URL).

So you should end up with **3 routes**:

- `GET /contests/{proxy+}`
- `PUT /contests/{proxy+}`
- `POST /contests/{proxy+}`

## 3. Attach the Lambda to each route

For **each** of the three routes:

1. Click the route (e.g. `GET /contests/{proxy+}`).
2. Under **Integration**, click **Attach integration** (or **Manage integration** if one exists).
3. Choose **Lambda function**.
4. Select your Lambda: **contest-api** (same region as the API).
5. Use **Payload format version 2.0** if asked.
6. Save.

Do the same for the **PUT** and **POST** routes so all three use the **contest-api** Lambda.

## 4. Enable CORS (required for browser / preflight)

The browser sends an **OPTIONS** request (preflight) before requests that use the `Authorization` header. API Gateway must respond to OPTIONS with CORS headers, or the request is blocked.

1. In the left sidebar, click **CORS**.
2. Click **Configure** (or **Edit**).
3. Set:
   - **Access-Control-Allow-Origin**: enter `*` to allow any origin (or for local dev add `http://localhost:3000` if your UI only allows specific origins).
   - **Access-Control-Allow-Methods**: check **GET**, **PUT**, **POST**, and **OPTIONS**.
   - **Access-Control-Allow-Headers**: enter `content-type, authorization` (or `Content-Type, Authorization` — case often doesn’t matter).
   - Leave **Access-Control-Max-Age** blank or set a number (e.g. `86400`).
4. Save.

If you use **Configure CORS** with a form that has separate fields, make sure **Allow origin** is not empty. Using `*` allows `http://localhost:3000` and your production domain.

## 5. Test the endpoint

Your **Invoke URL** is:

`https://xj8k273vj7.execute-api.us-east-1.amazonaws.com`

(No path after the host. No `/default` unless your API uses a custom stage.)

Test in a browser or with curl:

```text
GET https://xj8k273vj7.execute-api.us-east-1.amazonaws.com/contests/2026-1/config
```

You should get JSON with `contestId`, `numTeams`, `playersPerTeam`, and `managerNames`.

- If you get **403 Forbidden** or **404 Not Found**: the route or method is wrong. Check that you have `GET /contests/{proxy+}` and that its integration is **contest-api**.
- If you get **500** or a JSON `error`: the Lambda is running; check CloudWatch Logs for the Lambda to see the real error (e.g. missing S3 object or env vars).

## Quick checklist

- [ ] 3 routes: `GET`, `PUT`, `POST` each with path `/contests/{proxy+}`.
- [ ] All three routes integrated with Lambda **contest-api**.
- [ ] CORS configured: Allow-Origin `*` (or `http://localhost:3000`), methods GET, PUT, POST, **OPTIONS**, headers `content-type, authorization`.
- [ ] Lambda env vars: `CONTEST_BUCKET=rp-contest-data`, `BALLDONTLIE_API_KEY=your-key`.
- [ ] S3 bucket `rp-contest-data` has object `contests/2026-1/config.json`.
