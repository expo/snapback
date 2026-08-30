import { seed } from "snapback2";

export default seed({
  personas: ["alice"],
  rows: {
    todos: [{ id: "todo-1", title: "Ship Snapback 2", done: false, ownerId: "dev:alice", price: 999, status: "open" }],
  },
});
