import json
import urllib.request

def lambda_handler(event, context):
    params = (
        event.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("properties", [])
    )
    args = {p["name"]: p["value"] for p in params}



    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event["actionGroup"],
            "apiPath": event["apiPath"],
            "httpMethod": event["httpMethod"],
            "httpStatusCode": 200,
            "responseBody": {
                "application/json": {
                    "body": json.dumps({})
                }
            },
        },
    }
