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

/-- LLP 3000.036 §12.1's staff console: `read <- .owner = viewer or exists
staff[viewer]`, with each staff member able to read their own staff row
(`hiddenRoster`: nobody can, `read <- deny`). -/
def console (hiddenRoster : Bool := false) : Schema := { tables := [
  { name := "staff", cols := [c "principal"], uniques := [["principal"]]
    read := if hiddenRoster then .deny else .eq (self "principal") .viewer },
  { name := "tickets", cols := [c "owner"]
    read := .or (.eq (self "owner") .viewer) (.probe "staff" [("principal", .viewer)]) }] }

def consoleStore : Store := mkStore [
  ("staff", [mkRow "s1" [("principal", I "alice")]]),
  ("tickets", [mkRow "k1" [("owner", I "alice")], mkRow "k2" [("owner", I "bob")]])]

def allTickets : Program := query [.ret (.page "tickets" [] none [] false 10 none)]

/-- LLP 3000.036 §16.3's boards: `cards: read <- .author = viewer or exists
boards[.board, owner = viewer]`, the board readable by everyone
(`hiddenBoards`: by nobody, `read <- deny`). -/
def boardsSchema (hiddenBoards : Bool := false) : Schema := { tables := [
  { name := "boards", cols := [c "owner"], read := if hiddenBoards then .deny else .allow },
  { name := "cards", cols := [c "board", c "author"]
    read := .or (.eq (self "author") .viewer) (.probe "boards" [("id", self "board"), ("owner", .viewer)]) }] }

def boardStore : Store := mkStore [
  ("boards", [mkRow "b1" [("owner", I "olga")], mkRow "b2" [("owner", I "olga")]]),
  ("cards", [mkRow "k1" [("board", I "b1"), ("author", I "ann")],
             mkRow "k2" [("board", I "b1"), ("author", I "bo")]])]

def boardCards (b : String) : Program := query [.ret (.page "cards" [("board", idE b)] none [] false 10 none)]

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
  { name := "field-of-null"
    source := "why E_FIELD: ordinary field access propagates a null base as null"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.coalesce (.field (.point "todos" [("id", idE "nope")]) "title") (txt "none")) }
    tables := []
    expected := r#"{"kind":"answer","data":"none","complete":true,"next":null}"# },
  { name := "calendar-vectors"
    source := "LLP 3000.040 §2.2 and §5: the shared vectors — the epoch, 1969-12, 1900 (no leap day), 2000-02-29, 2026-10, year ends, the i53 ends"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.arr [.arr [.cal .month (int (0)), .cal .year (int (0))],
                .arr [.cal .month (int (-1)), .cal .year (int (-1))],
                .arr [.cal .month (int (-2678400000)), .cal .year (int (-2678400000))],
                .arr [.cal .month (int (-2678400001)), .cal .year (int (-2678400001))],
                .arr [.cal .month (int (951782400000)), .cal .year (int (951782400000))],
                .arr [.cal .month (int (951868800000)), .cal .year (int (951868800000))],
                .arr [.cal .month (int (1791676800000)), .cal .year (int (1791676800000))],
                .arr [.cal .month (int (1798761599999)), .cal .year (int (1798761599999))],
                .arr [.cal .month (int (1798761600000)), .cal .year (int (1798761600000))],
                .arr [.cal .month (int (-2203891200000)), .cal .year (int (-2203891200000))],
                .arr [.cal .month (int (-2203891200001)), .cal .year (int (-2203891200001))],
                .arr [.cal .month (int (9007199254740991)), .cal .year (int (9007199254740991))],
                .arr [.cal .month (int (-9007199254740991)), .cal .year (int (-9007199254740991))]]) }
    tables := []
    expected := r#"{"kind":"answer","data":[[0,1970],[-1,1969],[-1,1969],[-2,1969],[361,2000],[362,2000],[681,2026],[683,2026],[684,2027],[-838,1900],[-839,1900],[3425121,287396],[-3425122,-283457]],"complete":true,"next":null}"# },
  { name := "calendar-starts"
    source := "LLP 3000.040 §2.2: monthStart(681) is 2026-10-01; yearStart(2026); day, hour and bucket count fixed periods"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.arr [.cal .monthStart (int 681), .cal .monthStart (int (-1)), .cal .monthStart (int 361),
                .cal .yearStart (int 2026), .cal .yearStart (int 1970), .cal .yearStart (int 0),
                .cal (.period 86400000 0) (int 1791676800000), .cal (.period 86400000 28800000) (int 0),
                .cal (.period 3600000 0) (int (-1)), .cal (.period 7200000 1800000) (int 1791676800000)]) }
    tables := []
    expected := r#"{"kind":"answer","data":[1790812800000,-2678400000,949363200000,1767225600000,0,-62167219200000,20737,-1,-1,248843],"complete":true,"next":null}"# },
  { name := "calendar-overflow"
    source := "LLP 3000.040 §2.2: monthStart and yearStart refuse E_OVERFLOW outside i53, never a wrong instant"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.cal .monthStart (int 3425122)) }
    tables := []
    expected := r#"{"kind":"refused","code":"E_OVERFLOW"}"# },
  { name := "exists-search-witness"
    source := "LLP 3000.036 §15.12: a readable match proves presence: `true`, `complete: false` when the pins do not decide the rule"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.exists_ "todos" [] (some (.bin .eq (.dot "title") (txt "a")))) }
    tables := []
    expected := r#"{"kind":"answer","data":true,"complete":false,"next":null}"# },
  { name := "exists-search-undecided-absence"
    source := "LLP 3000.036 §15.12: with no readable match an undecided scan has no answer (never `false`)"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.exists_ "todos" [] (some (.bin .eq (.dot "title") (txt "b")))) }
    tables := []
    expected := r#"{"kind":"unavailable"}"# },
  { name := "exists-search-decided-absence"
    source := "LLP 3000.036 §15.12: a domain the pins decide (`.owner = viewer and …`) still answers `false`"
    case := { schema := todos, store := todoStore, viewer := alice,
              program := scalar (.exists_ "todos" [("ownerId", .viewer)] (some (.bin .eq (.dot "title") (txt "b")))) }
    tables := []
    expected := r#"{"kind":"answer","data":false,"complete":true,"next":null}"# },
  { name := "page-grant-holder"
    source := "LLP 3000.036 §12.1: a staff console's list is `complete: true` for staff"
    case := { schema := console, store := consoleStore, viewer := alice, program := allTickets }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","owner":"alice"},{"id":"k2","owner":"bob"}],"complete":true,"next":null}"# },
  { name := "page-grant-other"
    source := "LLP 3000.036.001 §2 case 2: everyone else reads the owner's branch of the merged page, complete (§12.1's 'unchanged' before it)"
    case := { schema := console, store := consoleStore, viewer := bob, program := allTickets }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k2","owner":"bob"}],"complete":true,"next":null}"# },
  { name := "page-grant-hidden-roster"
    source := "LLP 3000.036 §12.1: a hidden roster (`read <- deny`) is not a grant; the rows stay readable through the rule's probe"
    case := { schema := console true, store := consoleStore, viewer := alice, program := allTickets }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","owner":"alice"},{"id":"k2","owner":"bob"}],"complete":false,"next":null}"# },
  { name := "page-parent-guard-holder"
    source := "LLP 3000.036 §16.3: `exists boards[.board, owner = viewer]` under `.board = b` decides the board owner's page"
    case := { schema := boardsSchema, store := boardStore, viewer := cps "olga", program := boardCards "b1" }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","board":"b1","author":"ann"},{"id":"k2","board":"b1","author":"bo"}],"complete":true,"next":null}"# },
  { name := "page-parent-guard-other"
    source := "LLP 3000.036.001 §2 case 2: an author who does not own the board reads the author branch of the merged page, complete (§16.3's `complete: false` before it)"
    case := { schema := boardsSchema, store := boardStore, viewer := cps "ann", program := boardCards "b1" }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","board":"b1","author":"ann"}],"complete":true,"next":null}"# },
  { name := "page-parent-guard-hidden"
    source := "LLP 3000.036 §16.1: a pin-decided probe its holders cannot read decides nothing"
    case := { schema := boardsSchema true, store := boardStore, viewer := cps "olga", program := boardCards "b1" }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","board":"b1","author":"ann"},{"id":"k2","board":"b1","author":"bo"}],"complete":false,"next":null}"# },
  { name := "exists-parent-guard-absence"
    source := "LLP 3000.036 §15.12, §16.3: a scan its pins decide for the caller proves absence"
    case := { schema := boardsSchema, store := boardStore, viewer := cps "olga",
              program := scalar (.exists_ "cards" [("board", idE "b2")] none) }
    tables := []
    expected := r#"{"kind":"answer","data":false,"complete":true,"next":null}"# },
  { name := "id-not-text"
    source := "ticket 20260913 rule-equality-id-string: an id never equals a text"
    case := { schema := plain, store := Store.empty, viewer := alice,
              program := scalar (.bin .eq .viewer (txt "alice")) }
    tables := []
    expected := r#"{"kind":"answer","data":false,"complete":true,"next":null}"# }
]

/-! ## Merged pages (LLP 3000.036.001) -/

/-- Owner-or-assignee: a read rule of two parties. -/
def tasks : Schema := { tables := [{
  name := "tasks", cols := [c "owner", c "helper" (nullable := true), c "n"]
  read := .or (.eq (self "owner") .viewer) (.eq (self "helper") .viewer)
  insert := .eq (self "owner") .viewer }] }

def taskStore : Store := mkStore [("tasks", [
  mkRow "k1" [("owner", I "alice"), ("helper", .null), ("n", N 2)],
  mkRow "k2" [("owner", I "bob"), ("helper", I "alice"), ("n", N 0)],
  mkRow "k3" [("owner", I "bob"), ("helper", .null), ("n", N 5)],
  mkRow "k4" [("owner", I "carol"), ("helper", I "bob"), ("n", N 3)]])]

/-- PAGE's capped owner-or-membership rule. The membership cap is grouped by
the fixed viewer component; `parent` is the one dynamic target prefix. -/
def membershipDocs : Schema := { tables := [
  { name := "members", cols := [c "parent", c "principal"]
    uniques := [["parent", "principal"]]
    caps := [{ columns := ["principal"], max := 16 }]
    read := .eq (self "principal") .viewer },
  { name := "documents", cols := [c "owner", c "parent", c "at"]
    read := .or (.eq (self "owner") .viewer)
      (.probe "members" [("parent", self "parent"), ("principal", .viewer)]) }] }

def membershipDocStore : Store := mkStore [
  ("members", [mkRow "m1" [("parent", T "p1"), ("principal", I "alice")],
               mkRow "m2" [("parent", T "p2"), ("principal", I "alice")]]),
  ("documents", [mkRow "d1" [("owner", I "alice"), ("parent", T "p0"), ("at", N 1)],
                 mkRow "d2" [("owner", I "bob"), ("parent", T "p9"), ("at", N 2)],
                 mkRow "d3" [("owner", I "alice"), ("parent", T "p1"), ("at", N 3)],
                 mkRow "d4" [("owner", I "bob"), ("parent", T "p1"), ("at", N 4)],
                 mkRow "d5" [("owner", I "bob"), ("parent", T "p2"), ("at", N 5)]])]

/-- A membership keyed by the target row id is outside PAGE's ordinary-column
classifier and keeps the incomplete scan. -/
def membershipIdDocs : Schema := { tables := [
  { name := "shares", cols := [c "document", c "principal"]
    uniques := [["document", "principal"]]
    caps := [{ columns := ["principal"], max := 16 }]
    read := .eq (self "principal") .viewer },
  { name := "documents", cols := [c "owner", c "at"]
    read := .or (.eq (self "owner") .viewer)
      (.probe "shares" [("document", self "id"), ("principal", .viewer)]) }] }

def membershipIdStore : Store := mkStore [
  ("shares", [mkRow "s1" [("document", I "d2"), ("principal", I "alice")]]),
  ("documents", [mkRow "d1" [("owner", I "alice"), ("at", N 1)],
                 mkRow "d2" [("owner", I "bob"), ("at", N 2)]])]

def merged : List Example := [
  { name := "page-parties-merged"
    source := "LLP 3000.036.001 §2 case 2: a read rule of parties supplies the branches; the page is complete"
    case := { schema := tasks, store := taskStore, viewer := alice,
              program := query [.ret (.page "tasks" [] none [] false 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","owner":"alice","helper":null,"n":2},{"id":"k2","owner":"bob","helper":"alice","n":0}],"complete":true,"next":null}"# },
  { name := "page-where-branches"
    source := "LLP 3000.036.001 §2 case 1: each alternative of the where's or pins a party; the page is complete"
    case := { schema := tasks, store := taskStore, viewer := bob,
              program := query [.ret (.page "tasks" [] (some (.or (.bin .eq (.dot "owner") .viewer) (.bin .eq (.dot "helper") .viewer))) [] false 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k2","owner":"bob","helper":"alice","n":0},{"id":"k3","owner":"bob","helper":null,"n":5},{"id":"k4","owner":"carol","helper":"bob","n":3}],"complete":true,"next":null}"# },
  { name := "page-merged-lookahead"
    source := "LLP 3000.036.001 §5: a merged page continues only when another matching row follows"
    case := { schema := tasks, store := taskStore, viewer := alice, args := [("c", .null)],
              program := query [.ret (.page "tasks" [] (some (.bin .gt (.dot "n") (int 1))) [] false 1 (some (.var "c")))] [p "c" true] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","owner":"alice","helper":null,"n":2}],"complete":true,"next":null}"# },
  { name := "page-in-helper-not-merged"
    source := "LLP 3000.036.001 §2: a shared helper's page keeps the single-index plan, never complete under parties"
    case := { schema := tasks, store := taskStore, viewer := alice,
              helpers := [{ name := "mine", params := [], body := .page "tasks" [] none [] false 10 none }],
              program := query [.ret (.call "mine" [])] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"k1","owner":"alice","helper":null,"n":2},{"id":"k2","owner":"bob","helper":"alice","n":0}],"complete":false,"next":null}"# },
  { name := "exists-parties-false"
    source := "LLP 3000.036.001 §8: exists over parties is an or of decided existence reads, so it answers false"
    case := { schema := tasks, store := taskStore, viewer := cps "erin",
              program := query [.ret (.exists_ "tasks" [] (some (.or (.bin .eq (.dot "owner") .viewer) (.bin .eq (.dot "helper") .viewer))))] }
    tables := []
    expected := r#"{"kind":"answer","data":false,"complete":true,"next":null}"# },
  { name := "page-owner-membership-merged"
    source := "LLP 3000.036.001 §14: an owner range and capped per-parent membership ranges form one complete page"
    case := { schema := membershipDocs, store := membershipDocStore, viewer := alice,
              program := query [.ret (.page "documents" [] none ["at"] true 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"d5","owner":"bob","parent":"p2","at":5},{"id":"d4","owner":"bob","parent":"p1","at":4},{"id":"d3","owner":"alice","parent":"p1","at":3},{"id":"d1","owner":"alice","parent":"p0","at":1}],"complete":true,"next":null}"# },
  { name := "page-membership-target-pinned-in-alternatives-not-merged"
    source := "LLP 3000.036.001 §14: alternatives that pin the membership target keep the incomplete scan"
    case := { schema := membershipDocs, store := membershipDocStore, viewer := alice,
              program := query [.ret (.page "documents" [] (some (.or (.bin .eq (.dot "parent") (txt "p1")) (.bin .eq (.dot "parent") (txt "p2")))) ["at"] true 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"d5","owner":"bob","parent":"p2","at":5},{"id":"d4","owner":"bob","parent":"p1","at":4},{"id":"d3","owner":"alice","parent":"p1","at":3}],"complete":false,"next":null}"# },
  { name := "page-row-id-membership-not-merged"
    source := "LLP 3000.036.001 §14: a membership keyed by the target id keeps the incomplete scan"
    case := { schema := membershipIdDocs, store := membershipIdStore, viewer := alice,
              program := query [.ret (.page "documents" [] none ["at"] true 10 none)] }
    tables := []
    expected := r#"{"kind":"answer","data":[{"id":"d2","owner":"bob","at":2},{"id":"d1","owner":"alice","at":1}],"complete":false,"next":null}"# } ]


/-! ## Referential actions (LLP 3000.039) -/

def refCol (n t : String) (a : Option OnDelete) (nullable := false) : ColDecl := { name := n, nullable, ref := some t, onDelete := a }

/-- Projects cascade to their tasks (hidden from the project's owner); a note
restricts its task; a tag's optional task is cleared. -/
def projectsSchema : Schema := { tables := [
  { name := "projects", cols := [c "owner"], read := .allow, delete := .eq (self "owner") .viewer },
  { name := "tasks", cols := [refCol "project" "projects" (some .cascade), c "owner"],
    read := .eq (self "owner") .viewer, delete := .eq (self "owner") .viewer },
  { name := "notes", cols := [refCol "task" "tasks" (some .restrict)], read := .allow },
  { name := "tags", cols := [refCol "task" "tasks" (some .setNull) (nullable := true)], read := .allow },
  { name := "logs", cols := [refCol "task" "tasks" none], read := .allow }] }

def projectStore (note : Bool) : Store := mkStore [
  ("projects", [mkRow "p" [("owner", I "alice")]]),
  ("tasks", [mkRow "t1" [("project", I "p"), ("owner", I "bob")], mkRow "t2" [("project", I "p"), ("owner", I "bob")]]),
  ("notes", if note then [mkRow "n" [("task", I "t1")]] else []),
  ("tags", [mkRow "g" [("task", I "t2")]]),
  ("logs", [mkRow "l" [("task", I "t1")]])]

def refExamples : List Example := [
  { name := "delete-cascade"
    source := "LLP 3000.039 §3: a cascade deletes the referencing rows, hidden ones included; set null clears outside the closure; keep keeps"
    case := { schema := projectsSchema, store := projectStore false, viewer := alice,
              program := mutation [.write none (.delete "projects" [("id", idE "p")])] }
    tables := ["projects", "tasks", "tags", "logs"]
    expected := r#"{"kind":"committed","result":null,"store":{"projects":[],"tasks":[],"tags":[{"id":"g","task":null}],"logs":[{"id":"l","task":"t1"}]}}"# },
  { name := "delete-restrict-through-cascade"
    source := "LLP 3000.039 §3 step 4: a restrict reference to a closure row refuses E_REFERENCED"
    case := { schema := projectsSchema, store := projectStore true, viewer := alice,
              program := mutation [.write none (.delete "projects" [("id", idE "p")])] }
    tables := []
    expected := r#"{"kind":"refused","code":"E_REFERENCED"}"# },
  { name := "delete-referenced-needs-read"
    source := "LLP 3000.039 §3 step 1: a referenced row's deleter must read it (NOT_FOUND)"
    case := { schema := projectsSchema, store := projectStore false, viewer := alice,
              program := mutation [.write none (.delete "tasks" [("id", idE "t1")])] }
    tables := []
    expected := r#"{"kind":"refused","code":"NOT_FOUND"}"# }
]

/-- Every example: the guide cards' and the referential actions'. -/
def all : List Example := examples ++ merged ++ refExamples

/-- Run every example; returns the failures. -/
def check : List (String × String × String) :=
  all.filterMap fun ex =>
    let got := (run ex.case).toJson ex.tables
    match Json.parse ex.expected with
    | .ok want => if got == want then none else some (ex.name, want.compress, got.compress)
    | .error e => some (ex.name, "unparseable expectation: " ++ e, got.compress)

end Quarry.Examples
