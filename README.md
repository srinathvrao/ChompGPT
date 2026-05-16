# A food chatbot..

## Final build:

[Old plan (cringe)](img/flow.png)

New plan (based):

![system.png](img/system.png)

Use AWS AgentCore, and fargate containers + ALB instead of lambdas.

- lambda: pay for used execution time, cost goes crazy high. cold starting lambda is hella slow (provisioned concurrency helps, but cost problem still there).
- Fargate: pay for one lightweight container that's constantly running, always warm container - super fast responses. Can enable Application auto-scaling based on traffic.

Nitpick: Supabase could get overwhelmed.. Probably needs some Redis caching.


## What I want:

- Users can communicate with a chatbot
- bot knows restaurant locations
- bot also knows food items at each restaurant (probably a lot more work scraping menu data for this)

### Also:
- Only restaurants in the US.
- One-click CI/CD pipeline update my DB with newer restaurants (nice to have)

## Restaurant DB

Need a DB that could handle Geospatial data I'm going to throw at it. Basically, I want one that solves the K-nearest neighbors problem fast.

### DynamoDB? 

- Does not natively support geospatial indexing. 
- Needs "dynamodb-geo" library on top of DDB. 
    - This library will convert the lat/long to geohash
    - We can partition/sort the DB based on the geohash. AND run range queries -> some more filtering. 
    - NOT FUN - EXTRA PROCESSING :(

### CockroachDB?

- geospatial functionality exists 
- not as mature as PostGIS DBs below for heavy spatial workloads

### Postgres? I mean.. PostGIS?

- seems like industry standard..
- PostGIS spatial indexing available in: 
    - AWS RDS
    - Google Cloud SQL
    - Railway
    - Supabase
    - Neon
- Supabase and Neon have forever free tiers.. (NICE!)
- Supabase also provides true radius / KNN queries.
    - `ST_DWithin()`: radius search (uses index)
- I'll try Supabase, heard about it more than Neon.

### Location DBs that others use

- Uber
    - some kind of region-based sharding + db lookup, PostGIS for offline computation.
- Doordash? Grubhub?
    - Use PostGIS + caching for geospatial indexing.

## Chats DB

Can be a Key value store, `{session_uuids: [msg1, msg2, msg3]}`.
- 1000 chat messages..? need some pagination at some point, maybe something like:
    - `{ "session_uuid": "", "timestamp": "", "role": "", "content": "" }`

- DynamoDB.

## Data ingestion pipeline

Supabase DB has 500MB in free tier
- should be able to store restaurant data
- not the menu text - too much for this DB in free tier.

Data Sources:
- OpenStreetMaps
    - Free, doesn't reliably give me menu though.
- Google Maps API
    - usually has menu links,
    - limits on free tier.

Due to budget cuts (me not wanting to pay Supabase or Google), I'm going to skip adding the menu text for now, and hope I don't wake up to a $5000 AWS bill.

So my ingestion pipeline is just OpenStreetMaps -> Supabase.

## TODO

- [ ] OpenStreetMaps -> Supabase pipeline
- [ ] AWS CDK to spin up the chat DB, lambda, API Gateway.
- [ ] Extract the menu text somehow to a DB.. IDK HOW, $$$$ AI agents scraping menus? $$$$
