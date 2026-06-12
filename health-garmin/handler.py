import json
import os
from datetime import date, timedelta, datetime, timezone

import boto3
from garminconnect import Garmin

s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")


def load_garmin_credentials():
    secret_id = os.environ.get("GARMIN_SECRET_ID", "health/garmin")
    resp = secrets.get_secret_value(SecretId=secret_id)
    data = json.loads(resp["SecretString"])
    email = data.get("email") or data.get("username")
    password = data.get("password")
    if not email or not password:
        raise ValueError("Secret must contain email and password")
    return email, password


def safe_call(fn, default=None):
    try:
        return fn()
    except Exception as e:
        return default if default is not None else {"error": str(e)}


def collect_day(client, day):
    iso = day.isoformat()
    stats = safe_call(lambda: client.get_stats(iso), {})
    sleep = safe_call(lambda: client.get_sleep_data(iso), {})
    hrv = safe_call(lambda: client.get_hrv_data(iso), {})
    body_battery = safe_call(lambda: client.get_body_battery(iso), [])

    resting_hr = None
    steps = None
    if isinstance(stats, dict):
        resting_hr = stats.get("restingHeartRate") or stats.get("restingHeartRateValue")
        steps = stats.get("totalSteps") or stats.get("steps")

    sleep_score = None
    sleep_seconds = None
    if isinstance(sleep, dict):
        daily = sleep.get("dailySleepDTO") or sleep
        sleep_score = daily.get("sleepScoresOverall") or daily.get("sleepScore")
        sleep_seconds = daily.get("sleepTimeSeconds") or daily.get("durationInSeconds")

    hrv_ms = None
    if isinstance(hrv, dict):
        hrv_ms = hrv.get("lastNightAvg") or hrv.get("weeklyAvg") or hrv.get("hrvValue")

    bb_high = None
    if isinstance(body_battery, list) and body_battery:
        vals = [p.get("bodyBatteryValue") for p in body_battery if isinstance(p, dict)]
        vals = [v for v in vals if v is not None]
        if vals:
            bb_high = max(vals)

    return {
        "date": iso,
        "restingHeartRate": resting_hr,
        "steps": steps,
        "sleepScore": sleep_score,
        "sleepSeconds": sleep_seconds,
        "hrvMs": hrv_ms,
        "bodyBatteryHigh": bb_high,
    }


def latest_vo2(client):
    try:
        metrics = client.get_max_metrics(date.today().isoformat())
        if isinstance(metrics, dict):
            vo2 = metrics.get("vo2MaxValue") or metrics.get("vo2Max")
            if vo2 is not None:
                return vo2
    except Exception:
        pass
    for back in range(1, 15):
        d = (date.today() - timedelta(days=back)).isoformat()
        try:
            metrics = client.get_max_metrics(d)
            if isinstance(metrics, dict):
                vo2 = metrics.get("vo2MaxValue") or metrics.get("vo2Max")
                if vo2 is not None:
                    return vo2
        except Exception:
            continue
    return None


def build_summary(days, vo2_max):
    if not days:
        return {}
    latest = days[0]
    return {
        "vo2Max": vo2_max,
        "restingHeartRate": latest.get("restingHeartRate"),
        "sleepScore": latest.get("sleepScore"),
        "hrvMs": latest.get("hrvMs"),
        "steps": latest.get("steps"),
        "bodyBatteryHigh": latest.get("bodyBatteryHigh"),
    }


def handler(event, context):
    bucket = (event or {}).get("bucket") or os.environ.get("HEALTH_BUCKET")
    if not bucket:
        return {"ok": False, "error": "HEALTH_BUCKET not set"}

    try:
        email, password = load_garmin_credentials()
        client = Garmin(email, password)
        client.login()

        days = []
        for i in range(30):
            day = date.today() - timedelta(days=i)
            days.append(collect_day(client, day))

        vo2_max = latest_vo2(client)
        synced_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "syncedAt": synced_at,
            "days": days,
            "summary": build_summary(days, vo2_max),
        }

        s3.put_object(
            Bucket=bucket,
            Key="health/garmin/latest.json",
            Body=json.dumps(payload, indent=2),
            ContentType="application/json",
        )
        return {"ok": True, "syncedAt": synced_at, "dayCount": len(days)}
    except Exception as e:
        print("garmin sync error", e)
        return {"ok": False, "error": str(e)}
