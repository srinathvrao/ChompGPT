import json
import urllib.request

SUPABASE_URL = ""
SUPABASE_KEY = ""

def lambda_handler(request, context):

	try:
		if "limit_n" in request:
			request["limit_n"] = int(request["limit_n"])

		data = json.dumps(request).encode()
		req = urllib.request.Request(
			f"{SUPABASE_URL}/rest/v1/rpc/find_restaurants_by_address",
			data=data,
			headers={
				"apikey": SUPABASE_KEY,
				"Authorization": f"Bearer {SUPABASE_KEY}",
				"Content-Type": "application/json",
			},
			method="POST",
		)
		restaurants = {}
		with urllib.request.urlopen(req) as res:
			restaurants = json.loads(res.read())

		return restaurants

	except Exception as e:
		print(f"ERROR in lambda_handler: {type(e).__name__}: {e}")
		import traceback
		traceback.print_exc()
		raise