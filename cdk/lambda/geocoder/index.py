import csv
import difflib
import os

CSV_PATH = os.path.join(os.path.dirname(__file__), "nyc-geocoding.csv")

_ENTRIES = []

def _load():
    global _ENTRIES
    if _ENTRIES:
        return
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            _ENTRIES.append({
                "name": row["name"],
                "type": row["type"],
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "key": row["name"].lower(),
            })

def _lookup(query: str):
    _load()
    q = query.lower().strip()

    # 1. Exact
    for e in _ENTRIES:
        if e["key"] == q:
            return e, "exact"

    # 2. Substring - streets and landmarks only, ≥4 chars to avoid junk matches
    hits = [
        e for e in _ENTRIES
        if e["type"] != "neighbourhood" and len(e["key"]) >= 4
        and (q in e["key"] or e["key"] in q)
    ]
    if hits:
        hits.sort(key=lambda e: len(e["key"]))
        return hits[0], "substring"

    # 3. Fuzzy - streets and landmarks only
    keys = [e["key"] for e in _ENTRIES if e["type"] != "neighbourhood" and len(e["key"]) >= 4]
    close = difflib.get_close_matches(q, keys, n=1, cutoff=0.6)
    if close:
        return next(e for e in _ENTRIES if e["key"] == close[0]), "fuzzy"

    return None, None

def lambda_handler(event, context):
    query = (event.get("query") or "").strip()
    if not query:
        return {"error": "query parameter is required"}

    entry, method = _lookup(query)
    if entry:
        return {
            "name": entry["name"],
            "type": entry["type"],
            "lat": entry["lat"],
            "lon": entry["lon"],
            "source": method,
        }

    return {"error": f"Location not found: {query}"}

if __name__ == "__main__":
    req = {"query": "350 5th Ave"}
    print(lambda_handler(req, None))