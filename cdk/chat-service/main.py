from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import aiobotocore.session
import os
import json
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    session = aiobotocore.session.get_session()
    async with session.create_client(
        "bedrock-agentcore",
        region_name=os.environ["AWS_REGION"],
        config=bedrock_config,
    ) as client:
        app.state.bedrock_client = client
        yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Amz-Date", "X-Amz-Security-Token"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/chat")
async def invoke(request: Request):
    payload = await request.json()
    client = request.app.state.bedrock_client

    boto3_response = await client.invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENTCORE_RUNTIME_ARN"],
        payload=json.dumps(payload).encode(),
    )

    streaming_body = boto3_response["response"]
    content_type = boto3_response.get("contentType", "application/octet-stream")

    async def stream():
        async for chunk in streaming_body:
            yield chunk

    return StreamingResponse(stream(), media_type=content_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, access_log=False)