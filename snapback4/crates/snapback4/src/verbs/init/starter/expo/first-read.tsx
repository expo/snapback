import { Text } from "react-native";
import { matchRead, otherwiseAll, readPresentation, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";

// Your first read, to replace: api.OP is your first query that takes no
// required arguments. matchRead names the Read's states; `...otherwiseAll`
// renders every state you do not name (loading, partial, denied), and
// readPresentation(read).why is the refusal when there is one. A handler you
// add (`partial: rows => …`, `denied: why => …`) wins wherever you write it.
function FirstRead() {
  const read = useQuery(api.OP, {});
  return <Text>api.OP: {matchRead(read, { ...otherwiseAll(other => readPresentation(other).why?.message ?? "…"), present: data => JSON.stringify(data).slice(0, 200), absent: () => "nothing yet" })}</Text>;
}
