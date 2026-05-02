from strands import Agent
import os
import httpx
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamable_http_client
from bedrock_agentcore import BedrockAgentCoreApp

MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

SYSTEM_PROMPT = """
You are a helpful assistant that helps to find restaurants in a city with your restaurant finder tool.

List out the restaurants you find, and provide the names, lat/long, and cuisine and web link if available.
Addresses returned by the tool might be misorganized, you'd have to format them correctly as well for the user to read.
Start the user off with at most 5 recommendations and do more as requested.
"""

GATEWAY_URL = os.environ["GATEWAY_URL"]

app = BedrockAgentCoreApp()
@app.entrypoint
async def invoke(payload):
	""" AgentCore invocation for each request """

	user_prompt = payload.get("prompt", "")

	restaurant_mcp_client = MCPClient(
		lambda: streamable_http_client(
			GATEWAY_URL,
			http_client=httpx.AsyncClient()
		)
	)

	with restaurant_mcp_client:
		restaurant_tools = restaurant_mcp_client.list_tools_sync()
		agent =  Agent(
			model = MODEL_ID,
			system_prompt=SYSTEM_PROMPT,
			tools = [*restaurant_tools]
		)

		# response streaming...
		async for event in agent.stream_async(user_prompt):
			if "data" in event:
				yield str(event["data"])
			elif "event" in event:
				yield event

if __name__ == "__main__":
	app.run()