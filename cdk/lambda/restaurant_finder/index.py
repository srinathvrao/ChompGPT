import json
import urllib.request

SUPABASE_URL = ""
SUPABASE_KEY = ""

def lambda_handler(event, context):
    params = (
        event.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("properties", [])
    )
    args = {p["name"]: p["value"] for p in params}

    if "limit_n" in args:
        args["limit_n"] = int(args["limit_n"])

    data = json.dumps(args).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/find_restaurants_near_city",
        data=data,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        restaurants = json.loads(res.read())

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event["actionGroup"],
            "apiPath": event["apiPath"],
            "httpMethod": event["httpMethod"],
            "httpStatusCode": 200,
            "responseBody": {
                "application/json": {
                    "body": json.dumps(restaurants)
                }
            },
        },
    }
