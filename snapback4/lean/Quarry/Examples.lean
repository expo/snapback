import Quarry.Json

/-!
# Hand-written programs from the guide cards, with expected outcomes

Each case cites the card sentence its expectation comes from. `lake exe
quarry-model` runs them and fails on any mismatch.
-/

namespace Quarry.Examples
open Quarry
open Lean (Json)

/-! ## A small DSL -/

def T (s : String) : Scalar := .text (cps s)
def I (s : String) : Scalar := .id (cps s)
def N (n : Int) : Scalar := .int n
def mkRow (id : String) (cols : List (String × Scalar)) : Row := { id := cps id, cols }
def mkStore (xs : List (String × List Row)) : Store := fun t => (xs.lookup t).getD []
def c (n : String) (nullable := false) : ColDecl := { name := n, nullable }
def self (n : String) : Term := .col .self n
def old (n : String) : Term := .col .old n
def next (n : String) : Term := .col .next n
def lit (v : Value) : Expr := .lit v
def int (n : Int) : Expr := .lit (.ofInt n)
def txt (s : String) : Expr := .lit (.ofText s)
def idE (s : String) : Expr := .lit (.ofId s)
def query (body : List Stmt) (params : List Param := []) : Program :=
  { name := "q", kind := .query, params, body }
def mutation (body : List Stmt) (params : List Param := []) : Program :=
  { name := "m", kind := .mutation, params, body }
def p (n : String) (optional := false) : Param := { name := n, optional }

structure Example where
  name : String
  source : String
  case : Case
  tables : List String
  expected : String

/-! ## Schemas -/

/-- The language card's first table. -/
def todos : Schema := { tables := [{
  name := "todos", cols := [c "title", c "ownerId"]
  read := .eq (self "ownerId") .viewer
  insert := .eq (self "ownerId") .viewer
  update := .and (.eq (old "ownerId") .viewer) (.eq (next "ownerId") .viewer)
  delete := .eq (self "ownerId") .viewer }] }

def todoStore : Store := mkStore [("todos", [
  mkRow "t1" [("title", T "a"), ("ownerId", I "alice")],
  mkRow "t2" [("title", T "b"), ("ownerId", I "bob")],
  mkRow "t3" [("title", T "c"), ("ownerId", I "alice")],
  mkRow "t4" [("title", T "d"), ("ownerId", I "alice")]])]

def alice := cps "alice"
def bob := cps "bob"

/-- `return todos where .ownerId = viewer first 2 by .id after c` -/
def minePage : Program := query (params := [p "c" true])
  [.ret (.page "todos" [("ownerId", .viewer)] none [] false 2 (some (.var "c")))]

/-- The rules card's documents and editors. -/
def docs : Schema := { tables := [
  { name := "docs", cols := [c "ownerId", c "title", c "state"]
    read := .or (.eq (self "ownerId") .viewer) (.probe "editors" [("docId", self "id"), ("principal", .viewer)])
    insert := .and (.eq (self "ownerId") .viewer) (.eq (self "state") (.lit (T "draft")))
    update := .and (.and (.eq (old "ownerId") .viewer) (.eq (next "ownerId") .viewer))
      (.ne (old "state") (.lit (T "final")))
    delete := .eq (self "ownerId") .viewer },
  { name := "editors", cols := [c "docId", c "principal"], uniques := [["docId", "principal"]]
    read := .probe "editors" [("docId", self "docId"), ("principal", .viewer)]
    delete := .eq (self "principal") .viewer }] }

def docStore : Store := mkStore [
  ("docs", [mkRow "d1" [("ownerId", I "alice"), ("title", T "plan"), ("state", T "draft")]]),
  ("editors", [mkRow "e1" [("docId", I "d1"), ("principal", I "bob")]])]

/-- The language card's profiles: `unique handle else HANDLE_TAKEN`. -/
def profiles : Schema := { tables := [{
  name := "profiles", cols := [c "principal", c "handle"]
  uniques := [["principal"], ["handle"]], uniqueCodes := [none, some "HANDLE_TAKEN"]
  read := .allow, insert := .eq (self "principal") .viewer }] }

def profileStore : Store := mkStore [("profiles", [mkRow "p1" [("principal", I "bob"), ("handle", T "ann")]])]

/-- The reads card's room membership. -/
def rooms : Schema := { tables := [
  { name := "members", cols := [c "roomId", c "principal"], uniques := [["roomId", "principal"]]
    read := .probe "members" [("roomId", self "roomId"), ("principal", .viewer)] },
  { name := "messages", cols := [c "roomId", c "body"]
    read := .probe "members" [("roomId", self "roomId"), ("principal", .viewer)] }] }

def roomStore : Store := mkStore [
  ("members", [mkRow "m1" [("roomId", I "r1"), ("principal", I "alice")],
               mkRow "m2" [("roomId", I "r2"), ("principal", I "bob")]]),
  ("messages", [mkRow "x1" [("roomId", I "r1"), ("body", T "hi")],
                mkRow "x2" [("roomId", I "r1"), ("body", T "yo")],
                mkRow "x3" [("roomId", I "r2"), ("body", T "secret")]])]

def plain : Schema := { tables := [] }
def identityHelper : Helper := { name := "identity", params := ["x"], body := .var "x" }

/-- A table ordered by a text column, for code-point order. -/
def labels : Schema := { tables := [{ name := "labels", cols := [c "label"], read := .allow }] }
def labelStore : Store := mkStore [("labels", [
  mkRow "a" [("label", .text [0x10000])], mkRow "b" [("label", .text [0xE000])],
  mkRow "c" [("label", T "z")]])]

def scalar (e : Expr) : Program := query [.ret e]

/-! ## The examples -/

def examples : List Example := [
  { name := "page-first"
    source := "language card: `query` pages; reads card: filling a declared page bound is complete"
    case := { schema := todos, store := todoStore, viewer := alice, program := minePage }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"t1","title":"a","ownerId":"alice"},{"id":"t3","title":"c","ownerId":"alice"}],"complete":true,"next":["t3"]}"# },
  { name := "page-continue"
    source := "language card: pass `next` as `c`"
    case := { schema := todos, store := todoStore, viewer := alice, program := minePage,
              args := [("c", .arr [.s (I "t3")])] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"t4","title":"d","ownerId":"alice"}],"complete":true,"next":null}"# },
  { name := "page-cursorless-filled"
    source := "LLP 3000.027 §1: a cursorless top-N answer has no `next`; N_NO_CURSOR: filling first N is complete without next"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := query [.ret (.page "todos" [("ownerId", .viewer)] none [] false 2 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"t1","title":"a","ownerId":"alice"},{"id":"t3","title":"c","ownerId":"alice"}],"complete":true,"next":null}"# },
  { name := "page-cut"
    source := "bounds card: a query past a ceiling returns what it found with complete: false"
    case := { schema := todos, store := todoStore, viewer := alice, program := minePage, budget := some 1 }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"t1","title":"a","ownerId":"alice"}],"complete":false,"next":["t1"]}"# },
  { name := "page-nonuniform"
    source := "bounds card: a page whose read rule the prefix does not decide is never complete"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := query [.ret (.page "todos" [] none [] false 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"t1","title":"a","ownerId":"alice"},{"id":"t3","title":"c","ownerId":"alice"},{"id":"t4","title":"d","ownerId":"alice"}],"complete":false,"next":null}"# },
  { name := "point-hidden"
    source := "reads card: `one` returns a row/null; refusals card: a hidden row is null"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.point "todos" [("id", idE "t2")]) }
    tables := []
    expected := r#"{"kind":"answer","data":null,"complete":true,"next":null}"# },
  { name := "point-must-hidden"
    source := "reads card: `must` refuses missing/hidden rows"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.assert (.point "todos" [("id", idE "t2")]) "NOT_FOUND") }
    tables := []
    expected := r#"{"kind":"refused","code":"NOT_FOUND"}"# },
  { name := "count-visible"
    source := "reads card: count authorizes and filters each row"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.count "todos" [] none) }
    tables := []
    expected := r#"{"kind":"answer","data":3,"complete":true,"next":null}"# },
  { name := "count-cut"
    source := "bounds card: a streaming total with a meter cut is unavailable, never partial"
    case := { schema := todos, store := todoStore, viewer := alice, budget := some 2,
              program := scalar (.count "todos" [] none) }
    tables := []
    expected := r#"{"kind":"unavailable"}"# },
  { name := "exists-member"
    source := "reads card: `member = exists members[roomId, viewer]`"
    case := { schema := rooms, store := roomStore, viewer := alice,
              program := scalar (.record [
                ("r1", .exists_ "members" [("roomId", idE "r1"), ("principal", .viewer)] none),
                ("r2", .exists_ "members" [("roomId", idE "r2"), ("principal", .viewer)] none)]) }
    tables := []
    expected := r#"{"kind":"answer","data":{"r1":true,"r2":false},"complete":true,"next":null}"# },
  { name := "messages-through-membership"
    source := "reads card: messages readable through membership; a hidden room's page is empty"
    case := { schema := rooms, store := roomStore, viewer := alice,
              program := scalar (.record [
                ("r1", .count "messages" [("roomId", idE "r1")] none),
                ("r2", .page "messages" [("roomId", idE "r2")] none [] false 10 none)]) }
    tables := []
    expected := r#"{"kind":"answer","data":{"r1":2,"r2":[]},"complete":true,"next":null}"# },
  { name := "insert-denied"
    source := "rules card: insert returns E_RULE when the insert rule denies the viewer"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := mutation [.write none (.insert "todos"
                [("id", idE "t9"), ("title", txt "x"), ("ownerId", idE "bob")] false)] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_RULE"}"# },
  { name := "insert-hidden-clash"
    source := "rules card: a unique clash with a hidden row returns E_RULE"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := mutation [.write none (.insert "todos"
                [("id", idE "t2"), ("title", txt "x"), ("ownerId", idE "alice")] false)] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_RULE"}"# },
  { name := "insert-visible-clash-code"
    source := "language card: `unique handle else HANDLE_TAKEN`"
    case := { schema := profiles, store := profileStore, viewer := alice,
              program := mutation [.write none (.insert "profiles"
                [("id", idE "p2"), ("principal", idE "alice"), ("handle", txt "ann")] false)] }
    tables := []
    expected := r#"{"kind":"refused","code":"HANDLE_TAKEN"}"# },
  { name := "insert-if-absent"
    source := "writes card: `if absent` returns null on a readable key collision"
    case := { schema := profiles, store := profileStore, viewer := alice,
              program := mutation [.write (some "r") (.insert "profiles"
                [("id", idE "p2"), ("principal", idE "alice"), ("handle", txt "ann")] true), .ret (.var "r")] }
    tables := ["profiles"]
    expected := r#"{"kind":"committed","result":null,"store":{"profiles":[{"id":"p1","principal":"bob","handle":"ann"}]}}"# },
  { name := "insert-ok"
    source := "language card: `registerProfile` returns the inserted row"
    case := { schema := profiles, store := profileStore, viewer := alice,
              program := mutation [.write (some "r") (.insert "profiles"
                [("id", idE "p2"), ("principal", idE "alice"), ("handle", txt "cat")] false), .ret (.var "r")] }
    tables := ["profiles"]
    expected := r#"{"kind":"committed","result":{"id":"p2","principal":"alice","handle":"cat"},"store":{"profiles":[{"id":"p1","principal":"bob","handle":"ann"},{"id":"p2","principal":"alice","handle":"cat"}]}}"# },
  { name := "update-readable-denied"
    source := "rules card: update rule denial is E_RULE for a readable target"
    case := { schema := docs, store := docStore, viewer := bob,
              program := mutation [.write none (.update "docs" [("id", idE "d1")] [("title", txt "x")] none)] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_RULE"}"# },
  { name := "update-unreadable-denied"
    source := "rules card: update rule denial is NOT_FOUND for an unreadable target"
    case := { schema := docs, store := docStore, viewer := cps "carol",
              program := mutation [.write none (.update "docs" [("id", idE "d1")] [("title", txt "x")] none)] }
    tables := []
    expected := r#"{"kind":"refused","code":"NOT_FOUND"}"# },
  { name := "update-conflict"
    source := "writes card: `if` makes the update conditional: E_CONFLICT when false"
    case := { schema := docs, store := docStore, viewer := alice,
              program := mutation [.write none (.update "docs" [("id", idE "d1")] [("title", txt "x")]
                (some (.bin .eq (.dot "title") (txt "old"))))] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_CONFLICT"}"# },
  { name := "update-ok"
    source := "rules card: `update (old, next)` judges both images"
    case := { schema := docs, store := docStore, viewer := alice,
              program := mutation [.write (some "r") (.update "docs" [("id", idE "d1")] [("title", txt "x")]
                (some (.bin .eq (.dot "title") (txt "plan")))), .ret (.var "r")] }
    tables := ["docs"]
    expected := r#"{"kind":"committed","result":{"id":"d1","ownerId":"alice","title":"x","state":"draft"},"store":{"docs":[{"id":"d1","ownerId":"alice","title":"x","state":"draft"}]}}"# },
  { name := "delete-readable-denied"
    source := "rules card: delete returns E_RULE for a readable row whose delete rule refuses"
    case := { schema := docs, store := docStore, viewer := bob,
              program := mutation [.write none (.delete "docs" [("id", idE "d1")])] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_RULE"}"# },
  { name := "delete-missing"
    source := "rules card: delete returns NOT_FOUND for a missing id"
    case := { schema := docs, store := docStore, viewer := alice,
              program := mutation [.write none (.delete "docs" [("id", idE "nope")])] }
    tables := []
    expected := r#"{"kind":"refused","code":"NOT_FOUND"}"# },
  { name := "query-cannot-write"
    source := "language card: E_QUARRY_PLACEMENT: queries cannot write"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := query [.write none (.delete "todos" [("id", idE "t1")])] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_QUARRY_PLACEMENT"}"# },
  { name := "overflow"
    source := "why E_OVERFLOW: `9007199254740991 + 1` cannot be represented"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.bin .add (int 9007199254740991) (int 1)) }
    tables := []
    expected := r#"{"kind":"refused","code":"E_OVERFLOW"}"# },
  { name := "identity-sum"
    source := "LLP 3000.003: identity(1) + identity(2) returned 4; it must be 3"
    case := { schema := plain, store := Store.empty, viewer := alice, helpers := [identityHelper],
              program := scalar (.bin .add (.call "identity" [int 1]) (.call "identity" [int 2])) }
    tables := []
    expected := r#"{"kind":"answer","data":3,"complete":true,"next":null}"# },
  { name := "or-skips-assertion"
    source := "LLP 3000.003: a null assertion in the skipped side of `true or …` must not run"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.or (lit (.ofBool true)) (.assert (lit .null) "NULL_ASSERT")) }
    tables := []
    expected := r#"{"kind":"answer","data":true,"complete":true,"next":null}"# },
  { name := "require-code"
    source := "refusals card: `require name != '' else NAME_REQUIRED`"
    case := { schema := plain, store := Store.empty, viewer := alice, args := [("name", .ofText "")],
              program := query (params := [p "name"])
                [.require (.bin .ne (.var "name") (txt "")) "NAME_REQUIRED", .ret (.var "name")] }
    tables := []
    expected := r#"{"kind":"refused","code":"NAME_REQUIRED"}"# },
  { name := "euclidean"
    source := "language card: `%` has the same Euclidean parts as divmod; zero refuses E_DIV_ZERO"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.arr [.bin .div (int (-7)) (int 2), .bin .mod (int (-7)) (int 2)]) }
    tables := []
    expected := r#"{"kind":"answer","data":[-4,1],"complete":true,"next":null}"# },
  { name := "div-zero"
    source := "types card: a divisor must be nonzero: E_DIV_ZERO"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.bin .mod (int 1) (int 0)) }
    tables := []
    expected := r#"{"kind":"refused","code":"E_DIV_ZERO"}"# },
  { name := "codepoint-order"
    source := "LLP 3000.035 §2: text compares by code point (U+E000 before U+10000)"
    case := { schema := labels, store := labelStore, viewer := alice,
              program := scalar (.page "labels" [] none ["label"] false 10 none) }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"c","label":"z"},{"id":"b","label":""# ++
      String.singleton (Char.ofNat 0xE000) ++ r#""},{"id":"a","label":""# ++
      String.singleton (Char.ofNat 0x10000) ++ r#""}],"complete":true,"next":null}"# },
  { name := "id-not-text"
    source := "ticket 20260913 rule-equality-id-string: an id never equals a text"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.bin .eq .viewer (txt "alice")) }
    tables := []
    expected := r#"{"kind":"answer","data":false,"complete":true,"next":null}"# }
]

/-- Run every example; returns the failures. -/
def check : List (String × String × String) :=
  examples.filterMap fun ex =>
    let got := (run ex.case).toJson ex.tables
    match Json.parse ex.expected with
    | .ok want => if got == want then none else some (ex.name, want.compress, got.compress)
    | .error e => some (ex.name, "unparseable expectation: " ++ e, got.compress)

end Quarry.Examples
