import { describe, expect, test } from "bun:test";
import { readDrafts, writeDraft, EMPTY_DRAFT } from "../src/drafts";

class StorageStub {
  rows = new Map<string, string>();
  rejectWrites = false;
  get length() {
    return this.rows.size;
  }
  key(index: number) {
    return [...this.rows.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.rows.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.rejectWrites) throw new Error("Storage is full");
    this.rows.set(key, value);
  }
  removeItem(key: string) {
    if (this.rejectWrites) throw new Error("Storage is unavailable");
    this.rows.delete(key);
  }
}

describe("composer continuity", () => {
  test("reopening restores text and the exact edit base without crossing accounts", () => {
    const storage = new StorageStub();
    const edited = {
      body: "My revision",
      edit: { id: "m1", baseBody: "Original message" },
    };
    writeDraft(storage, "dev:alice", "studio", edited);
    writeDraft(storage, "dev:bob", "studio", { body: "Bob's separate words" });
    expect(readDrafts(storage, "dev:alice")).toEqual({ studio: edited });
    expect(readDrafts(storage, "dev:bob")).toEqual({
      studio: { body: "Bob's separate words" },
    });
    expect(readDrafts(storage, "dev:erin")).toEqual({});
  });

  test("saving and clearing one conversation preserves other saved drafts", () => {
    const storage = new StorageStub();
    writeDraft(storage, "dev:alice", "studio", { body: "First room" });
    writeDraft(storage, "dev:alice", "notes", { body: "Another room" });
    writeDraft(storage, "dev:alice", "studio", EMPTY_DRAFT);
    expect(readDrafts(storage, "dev:alice")).toEqual({
      notes: { body: "Another room" },
    });
  });

  test("a rejected write or clear leaves the last durable draft available and can retry", () => {
    const storage = new StorageStub();
    writeDraft(storage, "dev:alice", "studio", { body: "Saved" });
    storage.rejectWrites = true;
    expect(() =>
      writeDraft(storage, "dev:alice", "studio", { body: "Still in memory" }),
    ).toThrow();
    expect(() =>
      writeDraft(storage, "dev:alice", "studio", EMPTY_DRAFT),
    ).toThrow();
    expect(readDrafts(storage, "dev:alice").studio.body).toBe("Saved");
    storage.rejectWrites = false;
    writeDraft(storage, "dev:alice", "studio", { body: "Still in memory" });
    expect(readDrafts(storage, "dev:alice").studio.body).toBe(
      "Still in memory",
    );
  });

  test("invalid saved data produces an explicit error rather than an empty success", () => {
    const storage = new StorageStub();
    writeDraft(storage, "dev:alice", "studio", { body: "Saved" });
    storage.rows.set(storage.key(0)!, '{"body":17}');
    expect(() => readDrafts(storage, "dev:alice")).toThrow(
      "could not be opened",
    );
  });
});
