import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";

export const RESTAURANT_SCHEMA = [
  {
    name: "restaurant_finder",
    description: "Finds restaurants in a given city and state in the US. If the user didn't provide a state, figure it out yourself. The state is represented as a two-letter character.",
    inputSchema: {
      type: agentcore.SchemaDefinitionType.OBJECT,
      properties: {
        city_name: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "The name of the city in the USA",
        },
        city_state: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "The two letter name of the state in the USA",
        },
        cuisine: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "The cuisine requested for (e.g. pizza, italian, japanese, chinese)",
        },
        limit_n: {
          type: agentcore.SchemaDefinitionType.INTEGER,
          description: "The upper bound on the number of restaurants returned by the tool",
        },
      },
      required: ["city_name", "city_state"],
    },
  },
];

export const GEOCODER_SCHEMA = [
  {
    name: "geocoder",
    description: "Converts a place name, street address, neighbourhood, or landmark (e.g. 'Times Square', 'Hell's Kitchen', '350 5th Ave') into latitude and longitude coordinates. " + 
    "If you only have a location by neighborhood name or street, call this tool before searching for nearby restaurants. " +
    "If you don't get a good response, format the address into a probable one yourself.",
    inputSchema: {
      type: agentcore.SchemaDefinitionType.OBJECT,
      properties: {
        query: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "The place name, street address, neighbourhood, or landmark to geocode",
        },
      },
      required: ["query"],
    },
  },
];

export const RESTAURANT_BY_LATLON_SCHEMA = [
  {
    name: "nyc_latlon_restaurant_finder",
    description:
      "Finds NYC restaurants near a given latitude/longitude, sorted by distance. " +
      "Optionally filter by cuisine/type substring and price level. " +
      "Returns a distance_m field on each result. " +
      "If the result is empty, no restaurants match within p_radius_m - " +
      "consider widening the radius and retrying before telling the user nothing exists.",
    inputSchema: {
      type: agentcore.SchemaDefinitionType.OBJECT,
      properties: {
        p_lat: {
          type: agentcore.SchemaDefinitionType.NUMBER,
          description: "Latitude of the search center.",
        },
        p_lon: {
          type: agentcore.SchemaDefinitionType.NUMBER,
          description: "Longitude of the search center.",
        },
        metatxt: {
          type: agentcore.SchemaDefinitionType.STRING,
          description:
            "Optional cuisine or type substring (e.g. 'pizza', 'chinese', 'coffee'). " +
            "Matched as a case-insensitive substring against the restaurant's types field, " +
            "so pass a single keyword - not a list or boolean expression.",
        },
        pricelvl: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "Optional exact price level filter.",
          enum: [
            "PRICE_LEVEL_INEXPENSIVE",
            "PRICE_LEVEL_MODERATE",
            "PRICE_LEVEL_EXPENSIVE",
            "PRICE_LEVEL_VERY_EXPENSIVE",
          ],
        },
        p_radius_m: {
          type: agentcore.SchemaDefinitionType.NUMBER,
          description:
            "Search radius in meters around the lat/lon. Defaults to 2000 (~25 min walk). " +
            "Widen for broader 'anywhere in the borough' queries; tighten for 'right here' queries.",
        },
        limit_n: {
          type: agentcore.SchemaDefinitionType.INTEGER,
          description:
            "Max number of restaurants to return. Defaults to 50. Keep reasonable (≤100).",
        },
      },
      required: ["p_lat", "p_lon"],
    },
  },
];

export const RESTAURANT_BY_ADDRESS_SCHEMA = [
  {
    name: "nyc_address_restaurant_finder",
    description:
      "Finds NYC restaurants by matching against the address field - use this when the user " +
      "gives a specific address or street and wants the restaurant(s) at that location, " +
      "NOT when they want restaurants 'near' an address (use the lat/lon finder for that, " +
      "after geocoding). Matches are case-insensitive substrings, so partial addresses like " +
      "'123 Main' or 'Bedford Ave' work. Optionally narrow by restaurant name. " +
      "Results are ordered by popularity (user_ratings). " +
      "Empty results mean no address in the DB contains that substring - try a shorter or " +
      "differently-formatted fragment before giving up.",
    inputSchema: {
      type: agentcore.SchemaDefinitionType.OBJECT,
      properties: {
        addrtxt: {
          type: agentcore.SchemaDefinitionType.STRING,
          description:
            "Address substring to match (case-insensitive). Pass the most distinctive part - " +
            "e.g. '425 Lafayette' rather than the full 'New York, NY 10003' suffix. " +
            "Avoid abbreviations the data may not use ('St' vs 'Street'); shorter is safer.",
        },
        nametxt: {
          type: agentcore.SchemaDefinitionType.STRING,
          description:
            "Optional restaurant name substring to narrow results. Useful when an address " +
            "has multiple restaurants or the address match is broad.",
        },
        pricelvl: {
          type: agentcore.SchemaDefinitionType.STRING,
          description: "Optional exact price level filter.",
          enum: [
            "PRICE_LEVEL_INEXPENSIVE",
            "PRICE_LEVEL_MODERATE",
            "PRICE_LEVEL_EXPENSIVE",
            "PRICE_LEVEL_VERY_EXPENSIVE",
          ],
        },
        limit_n: {
          type: agentcore.SchemaDefinitionType.INTEGER,
          description:
            "Max number of restaurants to return. Defaults to 20. Keep reasonable (≤100).",
        },
      },
      required: ["addrtxt"],
    },
  },
];