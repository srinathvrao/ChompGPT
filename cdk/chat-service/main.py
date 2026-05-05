from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import aiobotocore.session
import os
import json

# This script is just a lightweight server that only forwards requests and streams responses.
# from agentcore

app = FastAPI()

botocore_session = aiobotocore.session.get_session()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/")
async def invoke(request: Request):
    payload = await request.json()

    client = await botocore_session.create_client(
        "bedrock-agentcore", 
        region_name=os.environ["AWS_REGION"]
    ).__aenter__()

    boto3_response = await client.invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENTCORE_RUNTIME_ARN"],
        payload=json.dumps(payload).encode(),
    )

    streaming_body = boto3_response["response"]
    content_type = boto3_response.get("contentType", "application/octet-stream")

    async def stream():
        try:
            async for chunk in streaming_body.iter_chunks(chunk_size=1024):
                yield chunk
        finally:
            await client.__aexit__(None, None, None)

    return StreamingResponse(stream(), media_type=content_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, access_log=False)