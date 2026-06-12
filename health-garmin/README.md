# health-garmin Lambda (Python)

Syncs last 30 days from Garmin Connect via `garminconnect`, writes `health/garmin/latest.json` to S3.

## AWS setup

1. Create Lambda **health-garmin**, runtime **Python 3.12**, handler **handler.handler**.
2. Env vars:
   - `HEALTH_BUCKET` = `rp-health-data`
   - `GARMIN_SECRET_ID` = `health/garmin`
3. IAM: `s3:PutObject` + `s3:GetObject` on `arn:aws:s3:::rp-health-data/*`, `secretsmanager:GetSecretValue` on the Garmin secret.
4. Timeout **90s**, memory **256 MB**.
5. Deploy zip (see below).
6. On **health-api** Lambda, add env `HEALTH_GARMIN_FUNCTION` = `health-garmin` and IAM `lambda:InvokeFunction` on this function.

### Secret `health/garmin`

```json
{"email": "your@garmin.com", "password": "your-password"}
```

## Build zip (from repo root, WSL or Linux recommended)

```bash
cd health-garmin
pip install -r requirements.txt -t package
cd package && zip -r ../health-garmin.zip . && cd ..
zip -g health-garmin.zip handler.py
```

On Windows, use WSL or Docker to build; pure Windows pip + zip often breaks native deps.

Upload **health-garmin.zip** to the Lambda console.
