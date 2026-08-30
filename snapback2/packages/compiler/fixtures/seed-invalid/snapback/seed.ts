import { seed } from "snapback2";

export default seed({
  personas: ["alice", "", "alice"],
  rows: {
    missing: [],
    entries: [
      { id: 7, status: "archived", amount: 9.99, tags: ["one", "two", "three"], data: { ratio: 1.5 }, extra: true },
      null,
    ],
  },
});
