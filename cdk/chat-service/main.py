from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import aiobotocore.session
import asyncio
import os
import json
import time
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from botocore.config import Config
from starlette.middleware.base import BaseHTTPMiddleware
import httpx
import jwt as pyjwt
from fastapi.responses import JSONResponse

# This script is just a lightweight server that only forwards requests and streams responses.
# from agentcore
# agentcore runtime allows only 25 invocations at a time- account level limitation.
# rate limits me if many more requests.
bedrock_config = Config(
    max_pool_connections=50,  # default is 10
    retries={"max_attempts": 3, "mode": "standard"},
    connect_timeout=5,
)

TABLE_NAME = os.environ["CHAT_HISTORY_TABLE"]
_cognito_keys = None
_cognito_keys_expiry = 0

async def get_cognito_public_keys():
    global _cognito_keys, _cognito_keys_expiry
    if _cognito_keys is None or time.time() > _cognito_keys_expiry:
        url = "https://cognito-identity.amazonaws.com/.well-known/jwks_uri"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            _cognito_keys = resp.json()
            _cognito_keys_expiry = time.time() + 86400
    return _cognito_keys

class RequireAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in ("/health",) or request.method == "OPTIONS":
            return await call_next(request)

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

        token = auth.split(" ")[1]
        try:
            keys = await get_cognito_public_keys()
            # Get the kid from token header to find the right key
            header = pyjwt.get_unverified_header(token)
            kid = header.get("kid")
            # Find matching key
            key = next((k for k in keys["keys"] if k["kid"] == kid), None)
            if not key:
                raise ValueError("Key not found")

            public_key = pyjwt.algorithms.RSAAlgorithm.from_jwk(key)
            pyjwt.decode(
                token,
                public_key,
                algorithms=["RS512"],
                audience=os.environ["IDENTITY_POOL_ID"],
            )
        except Exception as e:
            print(f"Auth failure: {e}")
            return JSONResponse(status_code=403, content={"detail": "Invalid token"})

        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    session = aiobotocore.session.get_session()
    async with session.create_client(
        "bedrock-agentcore",
        region_name=os.environ["AWS_REGION"],
        config=bedrock_config,
    ) as bedrock_client, session.create_client(
        "dynamodb",
        region_name=os.environ["AWS_REGION"],
    ) as dynamo_client:
        app.state.bedrock_client = bedrock_client
        app.state.dynamo_client = dynamo_client
        yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Amz-Date", "X-Amz-Security-Token"],
)
app.add_middleware(RequireAuthMiddleware)

async def load_history(dynamo_client, session_id: str, limit: int = 10) -> list:
    resp = await dynamo_client.query(
        TableName=TABLE_NAME,
        KeyConditionExpression="session_id = :sid",
        ExpressionAttributeValues={":sid": {"S": session_id}},
        ScanIndexForward=False,
        Limit=limit,
    )
    items = resp.get("Items", [])
    items.reverse()
    return [
        {"role": item["role"]["S"], "content": item["content"]["S"]}
        for item in items
    ]

async def save_message(dynamo_client, session_id: str, role: str, content: str, ip: str = None):
    now_s = int(time.time())
    ts = f"{now_s * 1000:016d}"
    expires_at = now_s + (30 * 24 * 60 * 60)

    item = {
        "session_id": {"S": session_id},
        "timestamp": {"S": ts},
        "role": {"S": role},
        "content": {"S": content},
        "expires_at": {"N": str(expires_at)},
    }
    if ip:
        item["client_ip"] = {"S": ip}

    await dynamo_client.put_item(TableName=TABLE_NAME, Item=item)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/history")
async def get_history(request: Request, sessionId: str, before: str = ""):
    dynamo_client = request.app.state.dynamo_client

    key_condition = "session_id = :sid"
    expr_values: dict = {":sid": {"S": sessionId}}
    expr_names: dict = {}

    if before:
        key_condition += " AND #ts < :cursor"
        expr_values[":cursor"] = {"S": before}
        expr_names["#ts"] = "timestamp"

    query_kwargs: dict = dict(
        TableName=TABLE_NAME,
        KeyConditionExpression=key_condition,
        ExpressionAttributeValues=expr_values,
        ScanIndexForward=False,
        Limit=10,
    )
    if expr_names:
        query_kwargs["ExpressionAttributeNames"] = expr_names

    resp = await dynamo_client.query(**query_kwargs)

    items = resp.get("Items", [])
    has_more = len(items) == 10
    items.reverse()

    return {
        "messages": [
            {
                "role": item["role"]["S"],
                "content": item["content"]["S"],
                "timestamp": item["timestamp"]["S"],
            }
            for item in items
        ],
        "hasMore": has_more,
    }

@app.delete("/session")
async def delete_session(request: Request, sessionId: str):
    dynamo_client = request.app.state.dynamo_client

    # Collect all keys for this session (may span multiple pages)
    keys = []
    last_key = None
    while True:
        kwargs: dict = dict(
            TableName=TABLE_NAME,
            KeyConditionExpression="session_id = :sid",
            ExpressionAttributeValues={":sid": {"S": sessionId}},
            ExpressionAttributeNames={"#ts": "timestamp"},
            ProjectionExpression="session_id, #ts",
        )
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = await dynamo_client.query(**kwargs)
        keys.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

    # Batch delete in chunks of 25 (DynamoDB limit)
    for i in range(0, len(keys), 25):
        await dynamo_client.batch_write_item(
            RequestItems={
                TABLE_NAME: [
                    {"DeleteRequest": {"Key": {
                        "session_id": item["session_id"],
                        "timestamp": item["timestamp"],
                    }}}
                    for item in keys[i:i + 25]
                ]
            }
        )

    return {"deleted": len(keys)}

@app.post("/chat")
async def invoke(request: Request):
    payload = await request.json()
    bedrock_client = request.app.state.bedrock_client
    dynamo_client = request.app.state.dynamo_client

    session_id = payload.get("sessionId", "")
    user_text = payload.get("prompt", "")

    history = await load_history(dynamo_client, session_id) if session_id else []

    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else None)

    if session_id and user_text:
        await save_message(dynamo_client, session_id, "user", user_text, ip=ip)

    enriched_payload = {**payload, "history": history}

    boto3_response = await bedrock_client.invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENTCORE_RUNTIME_ARN"],
        payload=json.dumps(enriched_payload).encode(),
    )

    streaming_body = boto3_response["response"]
    content_type = boto3_response.get("contentType", "application/octet-stream")

    assistant_chunks: list[str] = []

    async def stream():
        async for chunk in streaming_body:
            # Parse SSE lines to collect assistant text while streaming to client
            try:
                for line in chunk.decode("utf-8", errors="ignore").split("\n"):
                    if line.startswith("data: "):
                        try:
                            parsed = json.loads(line[6:])
                            delta = (
                                parsed.get("event", {})
                                .get("contentBlockDelta", {})
                                .get("delta", {})
                                .get("text", "")
                            )
                            if delta:
                                assistant_chunks.append(delta)
                        except Exception:
                            pass
            except Exception:
                pass
            yield chunk

        if session_id and assistant_chunks:
            asyncio.create_task(
                save_message(dynamo_client, session_id, "assistant", "".join(assistant_chunks))
            )

    return StreamingResponse(stream(), media_type=content_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, access_log=False)
