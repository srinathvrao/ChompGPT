"""
Fetches restaurant names and locations across an entire country from the
OpenStreetMap Overpass API.

# An example query from OSM Wizard (Overpass turbo) https://overpass-turbo.eu
[out:json][timeout:60];
area
  ["ISO3166-2"="US-NY"]
  ["admin_level"="4"]
  ->.searchArea;
nwr
  ["amenity"="restaurant"](area.searchArea);
out center;
"""

import requests
import csv
from typing import List, Dict
import os
from time import sleep

class OSMDownloader:

	def __init__(self, overpass_url):
		self.overpass_url = overpass_url

	def extractRestaurantsFromState(self, state_name: str, state_code: str) -> List[List[str]]:
		"""
			Function to extract the restaurant and related metadata from OpenStreetMaps
			Allows for future enrichment. Mandatory for now: name and lat,lon values.
			Returns:
				- List[List[str]]: A CSV-able list starting with the headings:
				["name", "lat", "lon", "address", "metadata", "web_link"]
		"""

		headers = {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'User-Agent': 'osm_scraper.py/1.0 (https://github.com)',
			'Referer': 'https://github.com'
		}

		overpass_query = '''
			[out:json]
			[timeout:60]
			;
			area
			["ISO3166-2"="''' + state_code + '''"]
			["admin_level"="4"]
			->.searchArea;
			nwr
			["amenity"="restaurant"]
			(area.searchArea);
			out center;
		'''

		response = requests.get(
			self.overpass_url, params={'data': overpass_query}, headers=headers
		)

		## Retry logic because it kept erroring out.
		if response.status_code == 429: # rate limits reached
			print("rate limit reached, sleeping..")
			sleep(10)
		retry = 0
		while (response.status_code in [204, 429]) and retry < 5:
			print("Got no response, retrying for", state_code)
			response = requests.get(
				self.overpass_url, params={'data': overpass_query}, headers=headers
			)
			retry += 1
			sleep(10)
		if response.status_code in [204, 429] or response.status_code >= 400:
			# should hopefully never happen..
			exit(1)

		elements = response.json().get('elements',[])
		restaurants = [["name", "lat", "lon", "address", "metadata", "web_link"]]

		for elem in elements:
			try:
				lat, lon = None, None
				if elem['type'] != 'node':
					lat, lon = elem['center']['lat'], elem['center']['lon']
				else:
					lat, lon = elem['lat'], elem['lon']

				if not lat or not lon:
					raise Exception("Cannot find lat or lon")
				web_link = ""
				addr = ""
				for key, val in elem["tags"].items():
					if "http" in val:
						web_link = val
					if "addr" in key:
						addr += val+" "
				row = [
					elem["tags"]["name"],
					lat,
					lon,
					addr,
					elem["tags"].get("cuisine",''),
					web_link
				]
				restaurants.append(row)

			except Exception as e:
				# OSM didn't return name / lat / lon of restaurant.. can't really do anything.
				pass
				# print(e,"not found in",elem,"..skipping")

		return restaurants

	def getUSAStateList(self) -> Dict:
		"""
			Function to list all the state codes for the country.
			Returns:
				- Dict: A mapping of state name -> state_code
		"""

		headers = {
			'Accept': 'application/json',
			'Content-Type': 'text/plain',
			'User-Agent': 'osm_scraper.py/1.0 (https://github.com)',
			'Referer': 'https://github.com'
		}

		overpass_query = '''
			[out:csv("name","ISO3166-2")]
			[timeout:30];
			area(3600148838)->.usa;
			relation
			["boundary"="administrative"]
			["admin_level"="4"]
			["ISO3166-2"~"^US-"]
			(area.usa);
			out ;
		'''

		response = requests.get(
			self.overpass_url, params={'data': overpass_query}, headers=headers
		)
		usa_states = {}
		if response.status_code == 200:
			for line in response.text.split("\n"):
				if "US-" in line:
					line = line.rstrip()
					code = line.split()[-1] # eg US-VT
					name = line.replace(code,"").strip()
					usa_states[name] = code
		print(f"{len(usa_states)} states extracted.")
		print(usa_states)
		return usa_states

if __name__ == "__main__":
	osm_scraper = OSMDownloader("https://overpass-api.de/api/interpreter")
	target_dir = "restaurant_db/"
	os.makedirs(target_dir, exist_ok=True)
	states = osm_scraper.getUSAStateList()
	if not states:
		exit(1)

	completed_states = os.listdir(target_dir)
	for state_name, state_code in states.items():
		if state_code+".csv" in completed_states:
			print("Restaurants already extracted for",state_code)
			continue

		print("Extracting restaurants for",state_name,state_code)
		restaurants = osm_scraper.extractRestaurantsFromState(state_name, state_code)
		print(f"{len(restaurants)-1} extracted for {state_name}")
		with open(target_dir + state_code+".csv", "w") as file:
			writer = csv.writer(file)
			writer.writerows(restaurants)