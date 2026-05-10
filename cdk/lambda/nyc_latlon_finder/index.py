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
			f"{SUPABASE_URL}/rest/v1/rpc/find_restaurants_near_coords",
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
		return {}

if __name__ == "__main__":
    req = {
		"p_lat": 40.7572385,
		"p_lon": -73.9860265,
		"metatxt": "pizza"
	}
    print(lambda_handler(req, None))