"""
Fetches restaurant names and locations across the entire US from the
OpenStreetMap Overpass API by tiling the country into a grid of bounding boxes.

# TODO the query from OSM Wizard
[out:json]
[timeout:25]
;
area
  ["ISO3166-2"="US-WA"]
  ["admin_level"="4"]
  ->.searchArea;
nwr
  ["amenity"="restaurant"]
  (area.searchArea);
out center;
"""
import requests

overpass_url = "https://overpass-api.de/api/interpreter"
# overpass_query = '''
# [out:csv("ISO3166-2")]
# [timeout:30];
# area(3600148838)->.usa;
# relation
#   ["boundary"="administrative"]
#   ["admin_level"="4"]
#   ["ISO3166-2"~"^US-"]
#   (area.usa);
# out ;
# '''

overpass_query = '''
[out:json]
[timeout:25]
;
area
  ["ISO3166-2"="US-WA"]
  ["admin_level"="4"]
  ->.searchArea;
nwr
  ["amenity"="restaurant"]
  (area.searchArea);
out center;
'''

headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'osm_scraper.py/1.0 (https://github.com)',
    'Referer': 'https://github.com'
}

response = requests.get(overpass_url, params={'data': overpass_query}, headers=headers)
usa_states = []
# if response.status_code == 200:
#     for line in response.text.split("\n"):
#         if "US-" in line:
#             usa_states.append(line.strip())
# else:
#     print("Failed", response.text)
#     exit(1)

# print("States extracted:")
# print(usa_states)


elements = response.json().get('elements',{})
if not elements:
    exit(1)

for elem in elements:
    if elem['type'] != 'node':
        print(elem['type'])