import { Text } from "react-native";
import { matchRead, otherwiseAll, readPresentation, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";

// Your first read, to replace: api.OP is your first query that takes no
// required arguments. matchRead names the Read's states; `...otherwiseAll`
// renders every state you do not name (loading, partial, denied), and
// readPresentation(read).why is the refusal when there is one.
function FirstRead() {
  const read = useQuery(api.OP, {});
  return <Text>api.OP: {matchRead(read, { present: data => JSON.stringify(data).slice(0, 200), absent: () => "nothing yet", ...otherwiseAll(other => readPresentation(other).why?.message ?? "…") })}</Text>;
}
