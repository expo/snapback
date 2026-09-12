import { useCallback, useState } from "react";

export type Edit = { id: string; baseBody: string };
export type Draft = { body: string; edit?: Edit };
export const EMPTY_DRAFT: Draft = { body: "" };
type Drafts = Record<string, Draft>;
type DraftStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

const prefix = (principal: string) =>
  `commonroom:draft:1:${encodeURIComponent(principal)}:`;
const validDraft = (value: unknown): value is Draft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Draft;
  return (
    typeof draft.body === "string" &&
    draft.body.length <= 2000 &&
    (draft.edit === undefined ||
      (typeof draft.edit.id === "string" &&
        typeof draft.edit.baseBody === "string" &&
        draft.edit.baseBody.length <= 2000))
  );
};

/** One record per account and room prevents another room's save from replacing it. */
export function readDrafts(storage: DraftStorage, principal: string): Drafts {
  const drafts: Drafts = Object.create(null);
  const account = prefix(principal);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(account)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const draft: unknown = JSON.parse(raw);
    if (!validDraft(draft))
      throw new Error("A saved draft could not be opened.");
    drafts[decodeURIComponent(key.slice(account.length))] = draft;
  }
  return drafts;
}

export function writeDraft(
  storage: DraftStorage,
  principal: string,
  room: string,
  draft: Draft,
): void {
  const key = prefix(principal) + encodeURIComponent(room);
  if (draft.body || draft.edit) storage.setItem(key, JSON.stringify(draft));
  else storage.removeItem(key);
}

// @ref LLP 2000#5-ownership-before-abstraction — unsent words survive reopening; failed local
// persistence remains visible, and account changes select a different shelf.
export function useDrafts(principal: string) {
  const [state, setState] = useState<{
    drafts: Drafts;
    unsaved: Drafts;
    error: string;
  }>(() => {
    try {
      return {
        drafts: readDrafts(window.localStorage, principal),
        unsaved: {},
        error: "",
      };
    } catch {
      return {
        drafts: {},
        unsaved: {},
        error:
          "Saved drafts could not be opened. Keep this tab open while you write.",
      };
    }
  });

  const update = useCallback(
    (room: string, draft: Draft): boolean => {
      let error = "";
      try {
        writeDraft(window.localStorage, principal, room, draft);
      } catch {
        error =
          "Your draft could not be saved on this device. Keep this tab open and retry.";
      }
      setState((current) => {
        const unsaved = { ...current.unsaved };
        if (error) unsaved[room] = draft;
        else delete unsaved[room];
        return {
          drafts: { ...current.drafts, [room]: draft },
          unsaved,
          error: error || (Object.keys(unsaved).length ? current.error : ""),
        };
      });
      return !error;
    },
    [principal],
  );

  const retry = useCallback(() => {
    const remaining: Drafts = {};
    for (const [room, draft] of Object.entries(state.unsaved)) {
      try {
        writeDraft(window.localStorage, principal, room, draft);
      } catch {
        remaining[room] = draft;
      }
    }
    let saved: Drafts = {};
    let error = "";
    try {
      saved = readDrafts(window.localStorage, principal);
    } catch {
      error =
        "Saved drafts still could not be opened. Your current words are safe in this tab.";
    }
    if (Object.keys(remaining).length)
      error =
        "Your draft still could not be saved on this device. Keep this tab open and retry.";
    setState((current) => ({
      drafts: { ...saved, ...current.drafts },
      unsaved: remaining,
      error,
    }));
  }, [principal, state.unsaved]);

  return { drafts: state.drafts, error: state.error, update, retry };
}
