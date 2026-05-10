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
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Amz-Date", "X-Amz-Security-Token"],
)

async def load_history(dynamo_client, session_id: str) -> list:
    resp = await dynamo_client.query(
        TableName=TABLE_NAME,
        KeyConditionExpression="session_id = :sid",
        ExpressionAttributeValues={":sid": {"S": session_id}},
        ScanIndexForward=True,
    )
    return [
        {"role": item["role"]["S"], "content": item["content"]["S"]}
        for item in resp.get("Items", [])
    ]

async def save_message(dynamo_client, session_id: str, role: str, content: str):
    ts = f"{int(time.time() * 1000):016d}"
    await dynamo_client.put_item(
        TableName=TABLE_NAME,
        Item={
            "session_id": {"S": session_id},
            "timestamp": {"S": ts},
            "role": {"S": role},
            "content": {"S": content},
        },
    )

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/chat")
async def invoke(request: Request):
    payload = await request.json()
    bedrock_client = request.app.state.bedrock_client
    dynamo_client = request.app.state.dynamo_client

    session_id = payload.get("sessionId", "")
    user_text = payload.get("prompt", "")

    history = await load_history(dynamo_client, session_id) if session_id else []

    if session_id and user_text:
        await save_message(dynamo_client, session_id, "user", user_text)

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
