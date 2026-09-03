import { seed } from "snapback2";

export default seed({
  personas: ["alice"],
  rows: {
    todos: [{ id: "todo-1", title: "Ship Snapback 2", done: false, ownerId: "dev:alice", price: 9.99, status: "open" }],
  },
});
