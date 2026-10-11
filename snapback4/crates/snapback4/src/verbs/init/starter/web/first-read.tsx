import { matchRead, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

// Your first read, to replace: api.OP is your first query that takes no
// required arguments. matchRead names the Read's states; `otherwise` covers
// the ones you omit (here loading), and denied and partial stay explicit.
function FirstRead() {
  const read = useQuery(api.OP, {});
  const wait = () => "…";
  return <p>api.OP: {matchRead(read, { present: data => JSON.stringify(data).slice(0, 200), absent: () => "nothing yet", denied: why => why.message, partial: wait, otherwise: wait })}</p>;
}
