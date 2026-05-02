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
}

]