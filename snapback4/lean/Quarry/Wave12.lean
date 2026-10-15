/-!
# Wave 12 semantic witnesses

These executable definitions cover language contracts outside the row IR:
global count visibility, capture-time count provenance, email validation, and
enum values entering the existing word-search path. Rounded division lives in
`Quarry.Eval` because it is an IR builtin.
-/

namespace Quarry.Wave12

def globalCount (rows : List α) : Nat := rows.length

@[simp] theorem globalCount_empty : globalCount ([] : List α) = 0 := rfl

theorem positive_count_has_member {rows : List α} (h : 0 < globalCount rows) :
    ∃ row, row ∈ rows := by
  cases rows with
  | nil => simp [globalCount] at h
  | cons row rows => exact ⟨row, by simp⟩

/-- A readable absent global count is zero; hidden hit and miss are both
`none`, so absence never becomes a disclosure channel. -/
def visibleGlobalCount (authorized : Bool) (stored : Option Nat) : Option Nat :=
  if authorized then some (stored.getD 0) else none

example : visibleGlobalCount true none = some 0 := rfl
example : visibleGlobalCount false none = none := rfl
example : visibleGlobalCount false (some 7) = none := rfl

/-- Binder provenance is a capture-time domain, transaction and authority
triple. A retained diagnostic origin is intentionally not part of it. -/
structure CountCapture where
  domain : String
  transaction : Nat
  authority : String
  definition : Nat
  deriving DecidableEq

def countCaptureLive (capture : CountCapture) (domain : String)
    (transaction : Nat) (authority : String) (definition : Nat) : Bool :=
  capture.domain == domain && capture.transaction == transaction &&
    capture.authority == authority && capture.definition == definition

example : countCaptureLive ⟨"entries/owner=alice", 4, "alice", 7⟩
    "entries/owner=alice" 4 "alice" 7 = true := rfl
example : countCaptureLive ⟨"entries/owner=alice", 4, "alice", 7⟩
    "entries/owner=alice" 5 "alice" 7 = false := rfl
example : countCaptureLive ⟨"entries/owner=alice", 4, "alice", 7⟩
    "entries/owner=bob" 4 "alice" 7 = false := rfl
example : countCaptureLive ⟨"entries/owner=alice", 4, "alice", 7⟩
    "entries/owner=alice" 4 "bob" 7 = false := rfl
example : countCaptureLive ⟨"entries/owner=alice", 4, "alice", 7⟩
    "entries/owner=alice" 4 "alice" 8 = false := rfl

/-- A keyed maintained count becomes required only for the exact key whose
role predicate was proved in the same transaction. A readable miss is zero;
hidden hits and misses share `none`. -/
def keyedTotalAfterRoleGuard (guardKey readKey : String)
    (sameTransaction authorized : Bool) (stored : Option Nat) : Option Nat :=
  if sameTransaction && authorized && guardKey == readKey
    then some (stored.getD 0)
    else none

example : keyedTotalAfterRoleGuard "dept-a" "dept-a" true true none = some 0 := rfl
example : keyedTotalAfterRoleGuard "dept-a" "dept-b" true true (some 7) = none := rfl
example : keyedTotalAfterRoleGuard "dept-a" "dept-a" false true (some 7) = none := rfl
example : keyedTotalAfterRoleGuard "dept-a" "dept-a" true false (some 7) = none := rfl

def asciiAlphaNum (c : Char) : Bool :=
  let n := c.toNat
  (65 ≤ n && n ≤ 90) || (97 ≤ n && n ≤ 122) || (48 ≤ n && n ≤ 57)

def asciiLower (c : Char) : Char :=
  if 65 ≤ c.toNat && c.toNat ≤ 90 then Char.ofNat (c.toNat + 32) else c

def splitOnce (needle : Char) : List Char → Option (List Char × List Char)
  | [] => none
  | c :: cs =>
      if c == needle then some ([], cs) else
        (splitOnce needle cs).map fun pair => (c :: pair.1, pair.2)

def splitDots : List Char → List (List Char)
  | [] => [[]]
  | c :: cs =>
      let rest := splitDots cs
      if c == '.' then [] :: rest else
        match rest with
        | [] => [[c]]
        | label :: labels => (c :: label) :: labels

def noAdjacentDots : List Char → Bool
  | '.' :: '.' :: _ => false
  | _ :: cs => noAdjacentDots cs
  | [] => true

def localPunctuation : List Char :=
  ['.', '!', '#', '$', '%', '&', '\'', '*', '+', '/', '=', '?', '^', '_', '`', '{', '|', '}', '~', '-']

def localPartValid (part : List Char) : Bool :=
  !part.isEmpty && part.length ≤ 64 && part.head? != some '.' &&
    part.getLast? != some '.' && noAdjacentDots part &&
    part.all fun c => asciiAlphaNum c || localPunctuation.contains c

def domainLabelValid (label : List Char) : Bool :=
  !label.isEmpty && label.length ≤ 63 &&
    label.head?.any asciiAlphaNum && label.getLast?.any asciiAlphaNum &&
    label.all fun c => asciiAlphaNum c || c == '-'

def emailValid (email : String) : Bool :=
  let chars := email.toList
  chars.length ≤ 254 && chars.all (·.toNat ≤ 127) &&
    chars.count '@' == 1 && match splitOnce '@' chars with
      | some (localChars, domain) => localPartValid localChars &&
          !domain.isEmpty && domain.length ≤ 253 && (splitDots domain).all domainLabelValid
      | none => false

example : emailValid "first.last+tag@sub.example" = true := by decide
example : emailValid "x@localhost" = true := by decide
example : emailValid "a..b@example.com" = false := by decide
example : emailValid "a@-example.com" = false := by decide
example : emailValid "a@пример.рф" = false := by decide

/-- ASCII executable witness for enum spellings using the shared word-search
shape: lowercase, alphanumeric token boundaries, and query-prefix matching.
The Rust/device tests own NFC and the production Unicode tables. -/
def asciiTokens (text : String) : List (List Char) :=
  let rec go (remaining current : List Char) (tokens : List (List Char)) :=
    match remaining with
    | [] => (if current.isEmpty then tokens else current.reverse :: tokens).reverse
    | c :: cs =>
        if asciiAlphaNum c then go cs (asciiLower c :: current) tokens
        else go cs [] (if current.isEmpty then tokens else current.reverse :: tokens)
  go text.toList [] []

def isPrefix : List Char → List Char → Bool
  | [], _ => true
  | _, [] => false
  | p :: ps, w :: ws => p == w && isPrefix ps ws

def enumMatchesAscii (value query : String) : Bool :=
  let words := asciiTokens value
  (asciiTokens query).all fun term => words.any fun word => isPrefix term word

example : enumMatchesAscii "coffee-shop" "cof" = true := by decide
example : enumMatchesAscii "book_store" "BOOK" = true := by decide
example : enumMatchesAscii "museum" "music" = false := by decide

end Quarry.Wave12
