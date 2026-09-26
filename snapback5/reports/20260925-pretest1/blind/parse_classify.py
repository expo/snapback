#!/usr/bin/env python3
"""Blind §7 classifier for the frozen LLP 4001 pre-test 1 corpus.

Uses Postgres's parser via pglast (libpg_query). Ubuntu noble ships pglast
6.2 / libpg_query 16.1; those packages are extracted under out/parser-deps.
This is not the Postgres 17 parser named in the RFC's verification paragraph.

Run from the pretest directory:
  python3 out/parse_classify.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path("/home/ccheever/sb5/pretest1-blind")
OUT = ROOT / "out"
DEPS = OUT / "parser-deps"
PGLAST_PATH = DEPS / "pglast/usr/lib/python3/dist-packages"
LIB_PATH = DEPS / "pgquery/usr/lib/x86_64-linux-gnu"
os.environ["LD_LIBRARY_PATH"] = str(LIB_PATH) + os.pathsep + os.environ.get(
    "LD_LIBRARY_PATH", ""
)
sys.path.insert(0, str(PGLAST_PATH))
# glibc reads LD_LIBRARY_PATH at process start. Preload the parser library
# so pglast's extension resolves it even when this script is launched bare.
import ctypes

ctypes.CDLL(str(LIB_PATH / "libpg_query.so.1605.1"), mode=ctypes.RTLD_GLOBAL)

from pglast import parse_sql  # noqa: E402
from pglast.enums.parsenodes import (  # noqa: E402
    AlterTableType,
    ConstrType,
    ObjectType,
    TransactionStmtKind,
)
from pglast.parser import get_postgresql_version, parse_plpgsql_json  # noqa: E402

CORPUS = ROOT / "corpus"
FILES = [
    "astra-supabase/schema.sql",
    "astra-supabase/scripts/mutations.sql",
    "astra-supabase/scripts/m7-migration.sql",
    "grok-supabase/server/schema.sql",
    "muse-supabase/db/schema.sql",
    "muse-supabase/db/rls.sql",
    "muse-supabase/db/functions.sql",
    "muse-supabase/db/rpcs.sql",
    "muse-supabase/db/migrate-m7.sql",
]
FAMILIES = {
    "astra-supabase": [f for f in FILES if f.startswith("astra-supabase/")],
    "grok-supabase": [f for f in FILES if f.startswith("grok-supabase/")],
    "muse-supabase": [f for f in FILES if f.startswith("muse-supabase/")],
}

# Named trigger bundles. Preservation is a behavior judgment, not a parse fact.
# bump_counters floors with greatest(); that side effect is not snapback.count.
# enforce_message_windows reads a config JSON interval and does not cover every
# writer. clqfa_like_counter is unconditional +1/-1 on insert/delete only.
BUNDLE = {
    "clqfa_like_counter": (
        True,
        "snapback.count",
        "Replace the like_count column and clqfa_like_counter trigger with "
        "like_count bigint generated always as (snapback.count('clqfa_likes', by => 'post')) stored; "
        "the trigger is unconditional +1 on insert and -1 on delete, with no floor, filter, or other write.",
        "Trigger body is not the §3.3 transition form (if not cond then raise exception 'E_RULE'; return new).",
        None,
    ),
    "ns_bump_counters": (
        False,
        None,
        None,
        "Trigger body is not the §3.3 transition form.",
        "greatest(count - 1, 0) floors the stored counter; snapback.count has no such side effect, "
        "so the registered count declaration does not preserve this bundle.",
    ),
    "ns_enforce_message_windows": (
        False,
        None,
        None,
        "Trigger body is not the §3.3 transition form and assigns NEW.",
        "The registered rewrite needs fixed-interval raise checks and edited assignments in every writer, "
        "including privileged paths. edit_s/del_s come from cfg_windows() JSON (defaults 900 and 3600), "
        "not a fixed interval, and direct UPDATE is allowed by the msg_upd policy with no edit mutation beside expire_tick.",
    ),
}
COUNT_COL = {
    ("clqfa_posts", "like_count"): "clqfa_like_counter",
    ("ns_posts", "like_count"): "ns_bump_counters",
    ("ns_posts", "repost_count"): "ns_bump_counters",
    ("ns_posts", "reply_count"): "ns_bump_counters",
}

RANK = {
    "ignored": 0,
    "admitted": 1,
    "canonicalized": 2,
    "rewritten": 3,
    "refused": 4,
}
ALLOWED_FUNCS = {
    "now",
    "length",
    "cardinality",
    "coalesce",
    "least",
    "greatest",
    "substr",
    "count",
    "sum",
    "json_build_object",
    "auth.uid",
}
SNAPBACK_FUNCS = {
    "count",
    "sum",
    "sequence",
    "recorded",
    "day",
    "bytes",
    "format",
    "cap",
    "matches",
    "connected",
    "emit",
    "period_start",
    "period_end",
    "bound",
    "mint",
    "created",
    "hour",
    "duration",
    "identity",
    "effect",
    "publish",
    "retain",
    "expire_at",
    "search",
    "immutable",
    "written_by",
    "once",
    "online_only",
    "server",
}
CMP_OPS = {"=", "<>", "!=", "<", "<=", ">", ">="}
ARITH_OPS = {"+", "-", "*"}
JSON_OPS = {"->", "->>", "#>", "#>>", "?", "?|", "?&", "@>", "<@", "||"}  # || also string/array
TRIGGER_VARS = {
    "tg_op",
    "tg_name",
    "tg_when",
    "tg_level",
    "tg_relid",
    "tg_relname",
    "tg_table_name",
    "tg_table_schema",
    "tg_nargs",
    "tg_argv",
}


def worst(classes):
    best = "ignored"
    for c in classes:
        if c and RANK[c] > RANK[best]:
            best = c
    return best if classes else "admitted"


def sval_list(nodes):
    if not nodes:
        return []
    out = []
    for n in nodes:
        if hasattr(n, "sval"):
            out.append(n.sval)
        else:
            out.append(str(n))
    return out


def qname(nodes):
    return ".".join(sval_list(nodes))


def enum_name(value):
    return getattr(value, "name", str(value))


def node_type(node):
    return type(node).__name__


def func_name(node):
    parts = [p.lower() for p in sval_list(node.funcname)]
    if len(parts) >= 2:
        return parts[-2] + "." + parts[-1]
    return parts[-1]


class Res:
    def __init__(
        self,
        cls,
        raw=None,
        post=None,
        rewrite=None,
        nodes=None,
        explanation=None,
        ambiguity=None,
        nullable=False,
    ):
        self.cls = cls
        self.raw = raw
        self.post = post
        self.rewrite = rewrite
        self.nodes = list(nodes or [])
        self.explanation = explanation
        self.ambiguity = ambiguity
        self.nullable = nullable

    def merge(self, other):
        if other is None:
            return self
        cls = worst([self.cls, other.cls])
        parts = [self, other]
        # Reasons come from the parts that determined the class, so an inlined
        # helper does not drown out a real refusal beside it.
        chosen = [p for p in parts if p.cls == cls] or parts
        raw = None
        post = None
        for part in chosen:
            raw = join_reason(raw, part.raw)
            post = join_reason(post, part.post)
        rewrites = [p.rewrite for p in parts if p.rewrite and p.cls == "rewritten"]
        rewrite = "; ".join(dict.fromkeys(rewrites)) or None
        nodes = []
        explanations = []
        for part in parts:
            if part.cls == "rewritten":
                nodes.extend(part.nodes)
                if part.explanation:
                    explanations.append(part.explanation)
        nodes = list(dict.fromkeys(nodes))
        explanation = " ".join(dict.fromkeys(explanations)) or None
        ambiguities = [p.ambiguity for p in parts if p.ambiguity]
        ambiguity = " ".join(dict.fromkeys(ambiguities)) or None
        nullable = self.nullable or other.nullable
        if cls != "rewritten":
            rewrite = None
            nodes = []
            explanation = None
        if cls != "refused":
            post = None
        if cls not in ("refused", "rewritten"):
            raw = None
        return Res(cls, raw, post, rewrite, nodes, explanation, ambiguity, nullable)


def join_reason(a, b):
    parts = [p for p in (a, b) if p]
    if not parts:
        return None
    return " ".join(dict.fromkeys(parts))


def ok_bool(nullable=False):
    return Res("admitted", nullable=nullable)


def refused(raw, post, ambiguity=None, nullable=True):
    return Res("refused", raw, post, ambiguity=ambiguity, nullable=nullable)


def rewritten(rewrite, nodes, explanation, raw, ambiguity=None, nullable=False):
    return Res(
        "rewritten",
        raw=raw,
        rewrite=rewrite,
        nodes=nodes,
        explanation=explanation,
        ambiguity=ambiguity,
        nullable=nullable,
    )


def unit_dict(uid, file, kind, res, name=None):
    ambiguity = res.ambiguity
    if name and ambiguity:
        ambiguity = ambiguity
    return {
        "id": uid,
        "file": file,
        "kind": kind,
        "class": res.cls,
        "rewrite": res.rewrite if res.cls == "rewritten" else None,
        "nodes": res.nodes if res.cls == "rewritten" and res.nodes else None,
        "explanation": res.explanation if res.cls == "rewritten" else None,
        "raw_refused": res.raw if res.cls in ("refused", "rewritten") else None,
        "post_rewrite_refused": res.post if res.cls == "refused" else None,
        "ambiguity": ambiguity,
    }


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class Column:
    def __init__(self, name, type_key, not_null=False, array=False):
        self.name = name
        self.type_key = type_key
        self.not_null = not_null
        self.array = array


class Table:
    def __init__(self, name):
        self.name = name
        self.cols = {}
        self.unique_keys = []
        self.rls = False


class Family:
    def __init__(self, name):
        self.name = name
        self.tables = {}
        self.helpers = {}  # function name -> True if exact probe helper
        self.uuid_ops = False
        self.uuid_op_evidence = ""

    def table(self, name):
        if name not in self.tables:
            self.tables[name] = Table(name)
        return self.tables[name]


def type_key_of(type_name):
    names = [p.lower() for p in sval_list(type_name.names)]
    key = names[-1]
    array = bool(type_name.arrayBounds)
    typmod = None
    if type_name.typmods:
        mod = type_name.typmods[0]
        if node_type(mod) == "A_Const" and not mod.isnull and node_type(mod.val) == "Integer":
            typmod = mod.val.ival
    return key, array, typmod


def column_from_def(coldef):
    key, array, typmod = type_key_of(coldef.typeName)
    not_null = False
    for c in coldef.constraints or []:
        ct = enum_name(ConstrType(c.contype) if not hasattr(c.contype, "name") else c.contype)
        if ct in ("CONSTR_NOTNULL", "CONSTR_PRIMARY", "CONSTR_IDENTITY"):
            not_null = True
    if key in ("bigserial", "serial", "smallserial"):
        not_null = True
    return Column(coldef.colname, key, not_null, array), typmod


def add_unique(table, cols):
    cols = tuple(cols)
    if cols and cols not in table.unique_keys:
        table.unique_keys.append(cols)
        for name in cols:
            if name in table.cols:
                table.cols[name].not_null = True


def fk_action_bad(cons):
    bad = set("crnd")
    for ch in (cons.fk_del_action or "", cons.fk_upd_action or ""):
        if ch in bad:
            return ch
    return None


def fk_target_auth(cons):
    if not cons.pktable:
        return False
    return (cons.pktable.schemaname or "") == "auth"


def apply_column_constraints(table, coldef):
    col, _ = column_from_def(coldef)
    # Preserve a previous not-null if a later alter omits it.
    prev = table.cols.get(col.name)
    if prev and prev.not_null:
        col.not_null = True
    table.cols[col.name] = col
    for c in coldef.constraints or []:
        ct = enum_name(c.contype)
        if ct == "CONSTR_PRIMARY":
            add_unique(table, [col.name])
        elif ct == "CONSTR_UNIQUE":
            keys = sval_list(c.keys) or [col.name]
            add_unique(table, keys)


def apply_table_constraint(table, cons):
    ct = enum_name(cons.contype)
    if ct == "CONSTR_PRIMARY":
        add_unique(table, sval_list(cons.keys))
    elif ct == "CONSTR_UNIQUE":
        add_unique(table, sval_list(cons.keys))


def index_colnames(stmt):
    names = []
    exprs = False
    for elem in stmt.indexParams or []:
        if elem.expr is not None or not elem.name:
            exprs = True
            names.append(None)
        else:
            names.append(elem.name)
    return names, exprs


def prepass_statement(family, stmt):
    kind = node_type(stmt)
    if kind == "CreateStmt":
        table = family.table(stmt.relation.relname)
        for el in stmt.tableElts or []:
            if node_type(el) == "ColumnDef":
                apply_column_constraints(table, el)
            elif node_type(el) == "Constraint":
                apply_table_constraint(table, el)
    elif kind == "AlterTableStmt":
        table = family.table(stmt.relation.relname)
        for cmd in stmt.cmds or []:
            sub = enum_name(cmd.subtype)
            if sub == "AT_AddColumn" and cmd.def_ is not None:
                apply_column_constraints(table, cmd.def_)
            elif sub == "AT_AddConstraint" and cmd.def_ is not None:
                apply_table_constraint(table, cmd.def_)
            elif sub == "AT_EnableRowSecurity":
                table.rls = True
    elif kind == "IndexStmt" and stmt.unique and not stmt.whereClause:
        names, exprs = index_colnames(stmt)
        if not exprs and all(names):
            add_unique(family.table(stmt.relation.relname), names)
    elif kind == "CreateFunctionStmt":
        register_helper(family, stmt)


def register_helper(family, stmt):
    lang, vol, sec, body = func_options(stmt)
    if lang != "sql" or vol != "stable" or not sec or not body:
        return
    ret = stmt.returnType
    if ret is None:
        return
    rkey, arr, _ = type_key_of(ret)
    if arr or rkey not in ("bool", "boolean"):
        return
    try:
        stmts = parse_sql(body)
    except Exception:
        return
    if len(stmts) != 1:
        return
    sel = stmts[0].stmt
    if node_type(sel) != "SelectStmt":
        return
    if sel.fromClause or sel.whereClause or sel.withClause or sel.op:
        return
    if not sel.targetList or len(sel.targetList) != 1:
        return
    val = sel.targetList[0].val
    if node_type(val) != "SubLink" or enum_name(val.subLinkType) != "EXISTS_SUBLINK":
        return
    if probe_shape(val.subselect, family):
        family.helpers[qname(stmt.funcname)] = True


def probe_shape(sel, family):
    """exists (select 1 from t where <full unique key> [and residual equality/null]*)."""
    if node_type(sel) != "SelectStmt":
        return False
    if any(
        [
            sel.withClause,
            sel.op,
            sel.whereClause is None,
            sel.groupClause,
            sel.havingClause,
            sel.windowClause,
            sel.sortClause,
            sel.limitCount,
            sel.lockingClause,
            sel.distinctClause,
        ]
    ):
        return False
    if not sel.targetList or len(sel.targetList) != 1:
        return False
    target = sel.targetList[0].val
    if not (node_type(target) == "A_Const" and not target.isnull and node_type(target.val) == "Integer"):
        return False
    if not sel.fromClause or len(sel.fromClause) != 1:
        return False
    frm = sel.fromClause[0]
    if node_type(frm) != "RangeVar":
        return False
    table = family.tables.get(frm.relname)
    if not table or not table.unique_keys:
        return False
    alias = frm.alias.aliasname if frm.alias else None
    covered = set()
    residuals_ok = True

    def walk_conj(node):
        nonlocal residuals_ok
        if node is None:
            residuals_ok = False
            return
        if node_type(node) == "BoolExpr" and enum_name(node.boolop) == "AND_EXPR":
            for arg in node.args:
                walk_conj(arg)
            return
        if node_type(node) == "NullTest" and not node.argisrow:
            parts = colref_parts(node.arg)
            col = scoped_col(parts, alias, table)
            if col:
                return
            residuals_ok = False
            return
        if node_type(node) == "A_Expr" and enum_name(node.kind) == "AEXPR_OP" and op_name(node) in ("=",):
            left = probe_side_col(node.lexpr, alias, table)
            right = probe_side_col(node.rexpr, alias, table)
            if left and not right and probe_side_term(node.rexpr):
                covered.add(left)
                return
            if right and not left and probe_side_term(node.lexpr):
                covered.add(right)
                return
            residuals_ok = False
            return
        residuals_ok = False

    walk_conj(sel.whereClause)
    if not residuals_ok:
        return False
    return any(set(key).issubset(covered) for key in table.unique_keys)


def scoped_col(parts, alias, table):
    if not parts or "*" in parts:
        return None
    if len(parts) == 1 and parts[0] in table.cols:
        return parts[0]
    if len(parts) == 2 and alias and parts[0] == alias and parts[1] in table.cols:
        return parts[1]
    if len(parts) == 2 and parts[0] == table.name and parts[1] in table.cols:
        return parts[1]
    return None


def probe_side_col(node, alias, table):
    return scoped_col(colref_parts(node), alias, table)


def probe_side_term(node):
    kind = node_type(node)
    if kind == "A_Const":
        return True
    if kind == "ColumnRef":
        parts = colref_parts(node)
        return bool(parts) and "*" not in parts
    if kind == "FuncCall" and func_name(node) == "auth.uid" and not node.args:
        return True
    return False


def colref_parts(node):
    if node is None or node_type(node) != "ColumnRef":
        return None
    parts = []
    for field in node.fields:
        tn = node_type(field)
        if tn == "String":
            parts.append(field.sval)
        elif tn == "A_Star":
            parts.append("*")
        else:
            return None
    return parts


def op_name(node):
    if not getattr(node, "name", None):
        return ""
    return "".join(sval_list(node.name))


def func_options(stmt):
    lang, vol, sec, body = None, None, False, None
    for opt in stmt.options or []:
        if opt.defname == "language" and opt.arg is not None:
            lang = opt.arg.sval.lower()
        elif opt.defname == "volatility" and opt.arg is not None:
            vol = opt.arg.sval.lower()
        elif opt.defname == "security" and opt.arg is not None:
            sec = bool(getattr(opt.arg, "boolval", opt.arg))
        elif opt.defname == "as" and opt.arg is not None:
            arg = opt.arg
            if isinstance(arg, (tuple, list)):
                body = arg[0].sval
            elif hasattr(arg, "sval"):
                body = arg.sval
    if vol is None:
        vol = "volatile"
    return lang, vol, sec, body


def scan_uuid_ops(family, text):
    """Accumulate UUID-specific operations across every file in the family."""
    import re

    evidence = []
    lowered = text.lower()
    if "::uuid" in lowered or "gen_random_uuid" in lowered or "uuid_generate" in lowered:
        evidence.append("`::uuid` / gen_random_uuid / uuid_generate")
    uuid_names = set()
    for table in family.tables.values():
        for col in table.cols.values():
            if col.type_key == "uuid":
                uuid_names.add(col.name.lower())
    for name in sorted(uuid_names):
        if re.search(r"(?<![a-z0-9_])" + re.escape(name) + r"\s*::", lowered):
            evidence.append(f"`{name}::`")
    if not evidence:
        return
    family.uuid_ops = True
    prev = [p for p in (family.uuid_op_evidence or "").split("; ") if p]
    for item in evidence:
        if item not in prev:
            prev.append(item)
    family.uuid_op_evidence = "; ".join(prev)


# ---------------------------------------------------------------------------
# Expressions
# ---------------------------------------------------------------------------


class Scope:
    def __init__(self, family, tables=None, aliases=None, rules=False):
        self.family = family
        self.tables = list(tables or [])
        self.aliases = dict(aliases or {})
        self.rules = rules

    def resolve(self, parts):
        if not parts or "*" in parts:
            return None
        if len(parts) == 1:
            hits = []
            for tname in self.tables:
                table = self.family.tables.get(tname)
                if table and parts[0] in table.cols:
                    hits.append(table.cols[parts[0]])
            if len(hits) == 1:
                return hits[0]
            if len(hits) > 1:
                # Agree only when every match is the same nullability and type.
                if all(h.type_key == hits[0].type_key and h.not_null == hits[0].not_null for h in hits):
                    return hits[0]
            return None
        if len(parts) >= 2:
            alias = parts[-2]
            col = parts[-1]
            tname = self.aliases.get(alias, alias if alias in self.family.tables else None)
            table = self.family.tables.get(tname) if tname else None
            if table and col in table.cols:
                return table.cols[col]
        return None


def check_expr(node, scope, bool_context):
    if node is None:
        return ok_bool(False)
    kind = node_type(node)
    if scope.rules and kind == "FuncCall" and func_name(node) in scope.family.helpers:
        name = func_name(node)
        return rewritten(
            "inline admitted probe helper",
            ["FuncCall", "SubLink"],
            f"Inline {name}, a language-sql stable security-definer body that is exactly a full-key probe, "
            "including any residual left_at is null or role equality.",
            f"Policy calls {name}; a function call is not itself a rule term until the probe is inlined (§3.3).",
            ambiguity="The probed principal column is a separate unit and may be a refused uuid column; "
            "§3.3 names Muse's is_member probe, with left_at is null, as an admitted rule.",
        )
    if scope.rules and is_expiry_or(node):
        return rewritten(
            "snapback.expire_at",
            ["NullTest", "A_Expr", "FuncCall"],
            "Read expiry spelled with expires_at is null or expires_at > now() is moved to snapback.expire_at, "
            "which is the §3.3 rewrite for now() and ordered comparison in a read rule.",
            "now() and ordered comparison are refused inside a rule expression.",
        )
    if kind == "A_Const":
        if node.isnull:
            return ok_bool(True)
        vk = node_type(node.val)
        if vk == "Float":
            return refused(
                "Float literal is not an admitted value.",
                "Floats are refused (§3.7) and there is no registered numeric rewrite.",
                nullable=False,
            )
        return ok_bool(False)
    if kind == "ColumnRef":
        parts = colref_parts(node)
        if not parts:
            return refused("Column reference could not be read.", "No registered rewrite for this reference.")
        if parts == ["*"] or parts[-1] == "*":
            return ok_bool(False)
        low = [p.lower() for p in parts]
        if low[-1] == "found" and len(low) == 1:
            return ok_bool(False)
        if low[0] in TRIGGER_VARS or low[-1] in TRIGGER_VARS or low[0] in ("new", "old"):
            return refused(
                "OLD/NEW or TG_* is not an admitted mutation/query term.",
                "Those names are admitted only inside §3.3's transition condition, which this statement is not.",
            )
        col = scope.resolve(parts)
        if col is not None:
            if bool_context and col.type_key in ("bool", "boolean"):
                if col.not_null:
                    return ok_bool(False)
                return refused(
                    f"Boolean column {col.name} is nullable.",
                    "Nullable boolean conditions are refused (§3.7), including under NOT; no rewrite preserves SQL unknown.",
                )
            return ok_bool(not col.not_null)
        # Parameter or local. Nullable. Bare use as a boolean is a nullable condition.
        if bool_context:
            return refused(
                f"Name {'.'.join(parts)} is not a known NOT NULL column.",
                "A bare parameter or local used as a boolean is a nullable condition and is refused (§3.7). "
                "Prior-statement narrowing is not tracked.",
                ambiguity="Ordered comparisons and boolean tests on parameters and locals are refused as nullable; "
                "an earlier IF that narrows nullness is a separate statement and is not treated as narrowing.",
            )
        return ok_bool(True)
    if kind == "FuncCall":
        return check_func(node, scope, bool_context)
    if kind == "CoalesceExpr":
        args = list(node.args or [])
        if len(args) != 2:
            return refused(
                "coalesce must be exactly two arguments (§3.7).",
                "There is no registered rewrite for other arities.",
            )
        merged = check_expr(args[0], scope, False).merge(check_expr(args[1], scope, False))
        merged.nullable = merged.nullable and check_expr(args[1], scope, False).nullable
        return merged
    if kind == "MinMaxExpr":
        args = list(node.args or [])
        if len(args) != 2:
            return refused(
                "least/greatest must have exactly two operands (§3.7).",
                "There is no registered rewrite for other arities.",
            )
        return check_expr(args[0], scope, False).merge(check_expr(args[1], scope, False))
    if kind == "BoolExpr":
        op = enum_name(node.boolop)
        parts = [check_expr(arg, scope, True) for arg in (node.args or [])]
        merged = ok_bool(False)
        for part in parts:
            merged = merged.merge(part)
        if op == "NOT_EXPR" and parts and parts[0].nullable and parts[0].cls != "refused":
            return refused(
                "NOT of a nullable boolean is refused (§3.7), including NOT of an ordered comparison.",
                "No rewrite turns SQL unknown into Quarry's false-on-null without changing meaning.",
            )
        if any(p.nullable for p in parts) and op in ("AND_EXPR", "OR_EXPR"):
            merged.nullable = True
        else:
            merged.nullable = False
        return merged
    if kind == "NullTest":
        if node.argisrow:
            return refused(
                "IS NULL on a record is refused.",
                "The registered rewrite is FOUND, which is a different statement and is not applied silently inside an expression.",
            )
        inner = check_expr(node.arg, scope, False)
        # The null test itself is the admitted spelling and yields a non-null boolean.
        if inner.cls == "refused":
            return inner
        inner.nullable = False
        return inner
    if kind == "BooleanTest":
        return refused(
            "IS TRUE / IS FALSE is not an admitted boolean spelling.",
            "Required booleans are spelled as the column or column = true; no rewrite is registered for IS TRUE.",
        )
    if kind == "SubLink":
        return check_sublink(node, scope, bool_context)
    if kind == "A_Expr":
        return check_aexpr(node, scope, bool_context)
    if kind == "TypeCast":
        return refused(
            "A type cast is not in the admitted expression subset.",
            "Casts such as ::uuid, ::text, ::int, and ::boolean have no registered rewrite.",
        )
    if kind == "CaseExpr":
        merged = ok_bool(False)
        if node.arg:
            merged = merged.merge(check_expr(node.arg, scope, False))
        for when in node.args or []:
            merged = merged.merge(check_expr(when.expr, scope, True))
            merged = merged.merge(check_expr(when.result, scope, False))
        if node.defresult:
            merged = merged.merge(check_expr(node.defresult, scope, False))
        merged.nullable = True
        return merged
    if kind == "A_ArrayExpr":
        merged = ok_bool(False)
        for elem in node.elements or []:
            merged = merged.merge(check_expr(elem, scope, False))
        return merged
    if kind == "RowExpr":
        merged = ok_bool(False)
        for elem in node.args or []:
            merged = merged.merge(check_expr(elem, scope, False))
        return merged
    if kind == "A_Star":
        return ok_bool(False)
    return refused(
        f"Expression node {kind} is outside the admitted subset.",
        "No unregistered rewrite is applied to this node.",
    )


def check_func(node, scope, bool_context):
    if node.over:
        return refused(
            "Window functions are refused (§3.7).",
            "No registered rewrite replaces a window function.",
        )
    if node.agg_distinct:
        return refused(
            "DISTINCT aggregates are not in the admitted subset.",
            "count and sum are admitted only without DISTINCT.",
        )
    name = func_name(node)
    if name.startswith("snapback."):
        short = name.split(".", 1)[1]
        if short not in SNAPBACK_FUNCS:
            return refused(
                f"snapback.{short} is not a stub listed in §3.7 A.",
                "No rewrite invents a new snapback call.",
            )
    elif name not in ALLOWED_FUNCS:
        return refused(
            f"Function {name} is not in the admitted expression subset.",
            "Only the §3.7 list, auth.uid(), json_build_object, and an inlined probe helper are admitted; "
            "this call is none of those.",
        )
    args = list(node.args or [])
    if name == "coalesce" and len(args) != 2:
        return refused(
            "coalesce must be exactly coalesce(a, b).",
            "Other arities are not the ?? spelling.",
        )
    if name in ("least", "greatest") and len(args) != 2:
        return refused(
            f"{name} must have exactly two operands.",
            "Other arities are not Quarry min/max.",
        )
    if name == "substr" and len(args) != 3:
        return refused(
            "substr must be substr(s, i, n) with three arguments.",
            "Other offsets are refused (§3.7).",
        )
    if name in ("now", "auth.uid") and args:
        return refused(
            f"{name} does not take arguments in the admitted spelling.",
            "No rewrite adds arguments to this call.",
        )
    if name == "count":
        merged = ok_bool(False)
    elif name == "sum":
        merged = ok_bool(True)
    elif name == "auth.uid":
        merged = ok_bool(False)
    elif name == "now":
        merged = ok_bool(False)
    else:
        merged = ok_bool(True)
    for arg in args:
        merged = merged.merge(check_expr(arg, scope, False))
    if name == "count":
        merged.nullable = False
    return merged


def check_sublink(node, scope, bool_context):
    stype = enum_name(node.subLinkType)
    if stype == "EXISTS_SUBLINK":
        if probe_shape(node.subselect, scope.family):
            return ok_bool(False)
        return refused(
            "exists subquery is not a full-key probe (select 1 from one table where a whole unique key is equated, plus residual equalities or null tests only).",
            "Arbitrary exists is not admitted; inlining a non-probe helper is not a registered rewrite.",
        )
    if stype == "ANY_SUBLINK":
        return check_in_select(node.subselect, scope)
    if stype == "EXPR_SUBLINK":
        return refused(
            "Scalar subquery is not an admitted expression.",
            "Point reads are select … into, not a parenthesized scalar; no rewrite moves it.",
        )
    return refused(
        f"SubLink {stype} is not an admitted probe or value-lane.",
        "No registered rewrite covers this subquery form.",
    )


def check_in_select(sel, scope):
    if node_type(sel) != "SelectStmt" or sel.withClause or sel.op or sel.groupClause or sel.windowClause:
        return refused(
            "in (select …) is not a single-column value lane.",
            "The admitted lane is in (select col from t where …) over a non-null column.",
        )
    if not sel.targetList or len(sel.targetList) != 1 or not sel.fromClause or len(sel.fromClause) != 1:
        return refused(
            "in (select …) must select one column from one table.",
            "Other shapes are refused.",
        )
    if node_type(sel.fromClause[0]) != "RangeVar":
        return refused("in (select …) FROM is not a base table.", "No rewrite is registered.")
    inner = scope_from([sel.fromClause[0]], scope.family, scope)
    col = inner.resolve(colref_parts(sel.targetList[0].val) or [])
    merged = check_expr(sel.targetList[0].val, inner, False)
    if sel.whereClause:
        merged = merged.merge(check_expr(sel.whereClause, inner, True))
    if col is None or not col.not_null:
        return refused(
            "in (select …) over a nullable or unknown column is refused.",
            "The value lane refuses a nullable column; null-safe IN is not a behavior-preserving rewrite of a list membership.",
        )
    return merged


def check_aexpr(node, scope, bool_context):  # noqa: F811
    kind = enum_name(node.kind)
    name = op_name(node)
    if name in {"->", "->>", "#>", "#>>", "?", "?|", "?&", "@>", "<@"} or name in {
        "~",
        "!~",
        "~~",
        "!~~",
        "~~*",
        "!~~*",
    }:
        return refused(
            f"Operator {name} is outside the admitted subset.",
            "jsonb operators are admitted only as json_build_object, and like/~ only as snapback.format; no rewrite preserves this operator.",
        )
    if name == "||":
        return refused(
            "|| is not treated as admitted list append.",
            "The expression subset admits || only for list building; string and jsonb concatenation are not that spelling, and operand types here are not snapback.id[].",
            ambiguity="|| was refused rather than rewritten because list concatenation cannot be separated from string concatenation in this AST.",
        )
    if kind == "AEXPR_IN":
        items_node = node.rexpr
        if node_type(items_node) == "SubLink":
            return check_expr(node.lexpr, scope, False).merge(check_sublink(items_node, scope, True))
        return refused(
            "IN (literal list) is not an admitted expression.",
            "check (col in (…)) is a constraint alias to enum, not a runtime IN-list rewrite.",
        )
    if kind in ("AEXPR_LIKE", "AEXPR_ILIKE", "AEXPR_SIMILAR"):
        return refused(
            "LIKE / SIMILAR is refused outside snapback.format.",
            "No rewrite turns an arbitrary pattern into a named format.",
        )
    if kind in ("AEXPR_BETWEEN", "AEXPR_NOT_BETWEEN", "AEXPR_BETWEEN_SYM", "AEXPR_NOT_BETWEEN_SYM"):
        ends = list(node.rexpr) if isinstance(node.rexpr, (tuple, list)) else [node.rexpr]
        merged = check_expr(node.lexpr, scope, False)
        for end in ends:
            merged = merged.merge(check_expr(end, scope, False))
        if merged.cls == "refused":
            return merged
        if check_expr(node.lexpr, scope, False).nullable or any(check_expr(end, scope, False).nullable for end in ends):
            return refused(
                "BETWEEN on a nullable operand is refused ordered comparison (§3.7).",
                "No null-safe rewrite preserves ordering.",
                ambiguity="Ordered comparisons and boolean tests on parameters and locals are refused as nullable; "
                "an earlier IF that narrows nullness is a separate statement and is not treated as narrowing.",
            )
        return merged
    if kind in ("AEXPR_DISTINCT", "AEXPR_NOT_DISTINCT") or name in ("is distinct from",):
        merged = check_expr(node.lexpr, scope, False).merge(check_expr(node.rexpr, scope, False))
        if merged.cls == "refused":
            return merged
        merged.nullable = False
        return merged
    if kind == "AEXPR_OP" and name in CMP_OPS | ARITH_OPS:
        left = check_expr(node.lexpr, scope, False)
        right = check_expr(node.rexpr, scope, False)
        merged = left.merge(right)
        if merged.cls == "refused":
            return merged
        if name in ARITH_OPS:
            merged.nullable = left.nullable or right.nullable
            return merged
        if name in ("<", "<=", ">", ">="):
            if left.nullable or right.nullable:
                return refused(
                    f"Ordered comparison {name} has a nullable operand.",
                    "Nullable ordering is refused (§3.7); there is no behavior-preserving rewrite.",
                    ambiguity="Ordered comparisons and boolean tests on parameters and locals are refused as nullable; "
                    "an earlier IF that narrows nullness is a separate statement and is not treated as narrowing.",
                )
            merged.nullable = False
            return merged
        if left.nullable or right.nullable:
            if not bool_context:
                return refused(
                    f"Bare {name} on a nullable operand is not a boolean condition.",
                    "The null-safe rewrite would change a produced value, so it is not applied.",
                )
            spell = "is not distinct from" if name == "=" else "is distinct from"
            base = rewritten(
                "null-safe equality",
                ["A_Expr"],
                f"Bare {name} on a nullable operand is rewritten to {spell} (§3.7); WHERE, CHECK, and IF treat unknown like false when the other side is non-null.",
                f"Bare {name} on a nullable operand is not an admitted spelling (§3.7).",
            )
            return base.merge(Res(merged.cls, merged.raw, merged.post, merged.rewrite, merged.nodes, merged.explanation, merged.ambiguity, False))
        merged.nullable = False
        if name == "<>":
            alias = Res(
                "canonicalized",
                ambiguity="<> on required operands is the registered alias of != (§3.7 one spelling).",
            )
            # canonicalized result should not carry raw. Res.merge clears raw when not refused/rewritten.
            return alias.merge(merged) if merged.cls != "admitted" else alias
        return merged
    return refused(
        f"Operator {name or kind} is not in the admitted expression subset.",
        "No registered rewrite covers this operator.",
    )


def scope_from(from_list, family, outer=None):
    tables = []
    aliases = {}
    if outer:
        tables.extend(outer.tables)
        aliases.update(outer.aliases)
    for item in from_list or []:
        if node_type(item) == "RangeVar":
            tables.append(item.relname)
            if item.alias:
                aliases[item.alias.aliasname] = item.relname
            aliases[item.relname] = item.relname
        elif node_type(item) == "JoinExpr":
            inner = scope_from([item.larg, item.rarg], family, None)
            tables.extend(inner.tables)
            aliases.update(inner.aliases)
    # Prefer the local FROM over an inherited outer of the same alias.
    return Scope(family, tables, aliases)


# ---------------------------------------------------------------------------
# SQL statements inside routines
# ---------------------------------------------------------------------------


def conjuncts(node):
    if node is None:
        return []
    if node_type(node) == "BoolExpr" and enum_name(node.boolop) == "AND_EXPR":
        out = []
        for arg in node.args:
            out.extend(conjuncts(arg))
        return out
    return [node]


def equality_binding(node, table, scope):
    if node_type(node) != "A_Expr" or enum_name(node.kind) != "AEXPR_OP" or op_name(node) != "=":
        return None
    left = scope.resolve(colref_parts(node.lexpr) or [])
    right = scope.resolve(colref_parts(node.rexpr) or [])
    # A binding is a column of this table equated to something that is not another
    # column of this same table.
    def is_self(col):
        return col is not None and col.name in table.cols and table.cols[col.name] is col

    if left and left.name in table.cols and not (right and right.name in table.cols):
        return left.name
    if right and right.name in table.cols and not (left and left.name in table.cols):
        return right.name
    return None


def covers_key(where, table, scope):
    if where is None or not table.unique_keys:
        return False
    bound = set()
    for part in conjuncts(where):
        name = equality_binding(part, table, scope)
        if name:
            bound.add(name)
    return any(set(key).issubset(bound) for key in table.unique_keys)


def classify_insert(stmt, scope):
    if stmt.withClause:
        return refused(
            "INSERT … WITH is a CTE.",
            "CTEs are refused (§3.7); removing the CTE is not a registered equivalence.",
        )
    sel = stmt.selectStmt
    if sel is None or sel.valuesLists is None:
        return refused(
            "insert … select is refused (§3.6).",
            "No registered rewrite turns insert-select into a point insert.",
        )
    if len(sel.valuesLists) != 1:
        return refused(
            "Multi-row VALUES is not insert t { … }.",
            "No rewrite splits a multi-row insert into admitted point inserts without changing conflict behavior.",
        )
    merged = ok_bool()
    for expr in sel.valuesLists[0]:
        merged = merged.merge(check_expr(expr, scope, False))
    oc = stmt.onConflictClause
    if oc is not None:
        action = enum_name(oc.action)
        infer_elems = list(oc.infer.indexElems) if oc.infer and oc.infer.indexElems else []
        if action == "ONCONFLICT_NOTHING":
            if infer_elems:
                return refused(
                    "on conflict (key) do nothing is not the targetless if-absent spelling.",
                    "The admitted if-absent form is targetless on conflict do nothing; specifying the arbiter changes which unique clash is absorbed.",
                    ambiguity="on conflict (key) do nothing was not rewritten to targetless do nothing, because those arbiters differ.",
                ).merge(merged)
        elif action == "ONCONFLICT_UPDATE":
            if not infer_elems:
                return refused(
                    "on conflict do update without a conflict target is not the upsert spelling.",
                    "Upsert requires on conflict (key) do update set col = excluded.col.",
                ).merge(merged)
            for target in oc.targetList or []:
                parts = colref_parts(target.val) if target.val is not None else None
                if not parts or parts[0].lower() != "excluded":
                    return refused(
                        "upsert SET does not use excluded only.",
                        "Existing-row expressions and partial field correspondence are refused (§3.6).",
                    ).merge(merged)
            if oc.whereClause:
                return refused(
                    "upsert has a WHERE on the conflict update.",
                    "That is an existing-row condition and is refused.",
                ).merge(merged)
        else:
            return refused("Unhandled ON CONFLICT action.", "No rewrite is registered.").merge(merged)
    if stmt.returningList:
        for target in stmt.returningList:
            if colref_parts(target.val) == ["*"]:
                continue
            merged = merged.merge(check_expr(target.val, scope, False))
    return merged


def classify_update(stmt, family):
    if stmt.withClause:
        return refused(
            "UPDATE … WITH is a CTE.",
            "CTEs are refused; CTE removal is not equivalence.",
        )
    if stmt.fromClause:
        return refused(
            "UPDATE … FROM is set-based.",
            "Only update t set … where <full unique key> [and cond] is admitted.",
        )
    if not stmt.relation:
        return refused("UPDATE has no target table.", "No rewrite is registered.")
    table = family.tables.get(stmt.relation.relname)
    scope = scope_from([stmt.relation], family)
    if table is None or not covers_key(stmt.whereClause, table, scope):
        return refused(
            "UPDATE WHERE does not equate a full unique key.",
            "Set-based update is refused (§3.6); moving the statement into a function is not an escape.",
        )
    merged = ok_bool()
    for part in conjuncts(stmt.whereClause):
        merged = merged.merge(check_expr(part, scope, True))
    for target in stmt.targetList or []:
        merged = merged.merge(check_expr(target.val, scope, False))
    if stmt.returningList:
        return refused(
            "UPDATE … RETURNING is not the point-update spelling.",
            "The admitted update form has no RETURNING.",
        ).merge(merged)
    return merged


def classify_delete(stmt, family):
    if stmt.withClause:
        return refused("DELETE … WITH is a CTE.", "CTEs are refused.")
    if stmt.usingClause:
        return refused("DELETE … USING is set-based.", "Only a full-key delete is admitted.")
    table = family.tables.get(stmt.relation.relname) if stmt.relation else None
    scope = scope_from([stmt.relation], family) if stmt.relation else Scope(family)
    if table is None or not covers_key(stmt.whereClause, table, scope):
        return refused(
            "DELETE WHERE does not equate a full unique key.",
            "Set-based delete is refused (§3.6).",
        )
    merged = ok_bool()
    for part in conjuncts(stmt.whereClause):
        merged = merged.merge(check_expr(part, scope, True))
    if stmt.returningList:
        return refused("DELETE … RETURNING is not the point-delete spelling.", "No rewrite adds RETURNING.").merge(merged)
    return merged


def classify_select_exec(stmt, family, as_page=False):
    if node_type(stmt) != "SelectStmt":
        return refused(f"{node_type(stmt)} is not a select.", "No rewrite is registered.")
    if stmt.withClause:
        return refused(
            "SELECT WITH is a CTE.",
            "CTEs are refused (§3.7); removing a CTE is not equivalence.",
        )
    if stmt.op and not stmt.all:
        return refused(
            "UNION (distinct) is refused.",
            "union all is a different spelling and is not an alias (§3.7).",
        )
    if stmt.op and stmt.all:
        return refused(
            "UNION ALL inside a routine statement is not a registered page, shape, or point read.",
            "The union-all spelling is a create view, not this statement.",
        )
    if stmt.windowClause:
        return refused("Window functions are refused.", "No rewrite replaces them.")
    if stmt.lockingClause:
        return refused(
            "SELECT … FOR UPDATE/SHARE is not an admitted read.",
            "Locking clauses have no §3.6 spelling.",
        )
    scope = scope_from(stmt.fromClause, family)
    merged = ok_bool()
    for target in stmt.targetList or []:
        if colref_parts(target.val) == ["*"]:
            continue
        merged = merged.merge(check_expr(target.val, scope, False))
    if stmt.whereClause:
        merged = merged.merge(check_expr(stmt.whereClause, scope, True))
    if stmt.havingClause:
        merged = merged.merge(check_expr(stmt.havingClause, scope, True))
    if merged.cls == "refused":
        return merged
    # Aggregate into / streamed count.
    if (
        stmt.targetList
        and len(stmt.targetList) == 1
        and node_type(stmt.targetList[0].val) == "FuncCall"
        and func_name(stmt.targetList[0].val) in ("count", "sum")
        and not stmt.op
    ):
        if stmt.fromClause and any(node_type(f) != "RangeVar" for f in stmt.fromClause):
            return refused(
                "Joined aggregate is not the single-relation streamed count/sum.",
                "No rewrite preserves join cardinality inside count(*).",
            )
        return merged
    if as_page:
        if stmt.limitCount is None:
            return refused(
                "return query without LIMIT is not a terminal page and is not an unpaged scan with a demonstrated cap.",
                "Unpaged collections need a fitting cap or pinned audience (§3.5); that bound is not established here. A keyset predicate is not a cursor.",
            )
        return merged
    # Point read: one base table and a full key, or first() = order by limit 1.
    if stmt.fromClause and len(stmt.fromClause) == 1 and node_type(stmt.fromClause[0]) == "RangeVar":
        table = family.tables.get(stmt.fromClause[0].relname)
        if table and covers_key(stmt.whereClause, table, scope):
            return merged
        if stmt.limitCount is not None and stmt.sortClause:
            alias = Res(
                "admitted",
                ambiguity="select … order by … limit 1 is read as first(read) (§3.5), which yields null on no row.",
            )
            return alias.merge(merged) if merged.cls != "admitted" else alias
    return refused(
        "SELECT is not a full-key point read, a limit-1 first(), or a single-relation count/sum.",
        "Set-based reads and keyset predicates are not given an unregistered rewrite.",
    )


def classify_sql_statement(stmt, family, mode):
    kind = node_type(stmt)
    if kind == "InsertStmt":
        scope = scope_from([stmt.relation], family) if stmt.relation else Scope(family)
        return classify_insert(stmt, scope)
    if kind == "UpdateStmt":
        return classify_update(stmt, family)
    if kind == "DeleteStmt":
        return classify_delete(stmt, family)
    if kind == "SelectStmt":
        return classify_select_exec(stmt, family, as_page=(mode == "page"))
    return refused(
        f"SQL statement {kind} is not an admitted body statement.",
        "§3.6's finite grammar does not include it, and no unregistered rewrite is invented.",
    )


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


def policy_expr(node, scope, family):
    if node is None:
        return ok_bool()
    scope.rules = True
    return check_expr(node, scope, True)


def is_expiry_or(node):
    if node_type(node) != "BoolExpr" or enum_name(node.boolop) != "OR_EXPR":
        return False
    args = list(node.args or [])
    if len(args) != 2:
        return False
    nullish = [a for a in args if node_type(a) == "NullTest"]
    comps = [a for a in args if node_type(a) == "A_Expr"]
    if len(nullish) != 1 or len(comps) != 1:
        return False
    if enum_name(nullish[0].nulltesttype) != "IS_NULL":
        return False
    if op_name(comps[0]) != ">":
        return False
    ncol = colref_parts(nullish[0].arg)
    lcol = colref_parts(comps[0].lexpr)
    rfunc = comps[0].rexpr
    if not ncol or not lcol or ncol[-1].lower() != "expires_at" or lcol[-1].lower() != "expires_at":
        return False
    return node_type(rfunc) == "FuncCall" and func_name(rfunc) == "now"


def classify_policy(stmt, family):
    table = family.tables.get(stmt.table.relname)
    scope = Scope(family, [stmt.table.relname], {stmt.table.relname: stmt.table.relname})
    if table is None or not table.rls:
        base = refused(
            "Policy is on a table without enable row level security, or the table is not in the family catalog.",
            "§3.2 refuses a policy without RLS; owners do not bypass, and no rewrite invents RLS enablement as part of the policy.",
        )
    else:
        base = ok_bool()
    cmd = (stmt.cmd_name or "all").lower()
    qual = policy_expr(stmt.qual, scope, family) if stmt.qual is not None else None
    check = policy_expr(stmt.with_check, scope, family) if stmt.with_check is not None else None
    merged = base
    if cmd == "insert":
        if check is None:
            return refused("INSERT policy has no WITH CHECK.", "Insert rules are with check (expr).")
        merged = merged.merge(check)
    elif cmd == "update":
        if qual is None and check is not None:
            return refused(
                "UPDATE with check alone is refused (§3.3).",
                "The registered rewrite to using (E) with check (E) is not behavior-preserving: Postgres supplies USING true when USING is omitted, so adding USING (E) narrows the old image.",
            ).merge(check)
        if qual is not None:
            merged = merged.merge(qual)
        if check is not None:
            merged = merged.merge(check)
        if qual is not None and (check is None or True):
            merged.ambiguity = join_reason(
                merged.ambiguity,
                "No snapback.immutable call exists, so using (E) [with check (E)] is not the single-image alias; "
                "it is the composed old/next rule. Primary keys were not treated as implicitly immutable.",
            )
    elif cmd in ("select", "delete"):
        if qual is None:
            return refused(f"{cmd} policy has no USING expression.", "The admitted spelling has using (expr).")
        merged = merged.merge(qual)
    elif cmd == "all":
        if qual is not None:
            merged = merged.merge(qual)
        if check is not None:
            merged = merged.merge(check)
        merged.ambiguity = join_reason(
            merged.ambiguity,
            "for all is the admitted multi-effect spelling; without snapback.immutable it is not canonicalized to a single-image update.",
        )
    else:
        return refused(f"Policy command {cmd} is not select/insert/update/delete/all.", "No rewrite is registered.")
    # to authenticated is ignored boilerplate on the policy, not its own unit.
    return merged


# ---------------------------------------------------------------------------
# Columns and constraints
# ---------------------------------------------------------------------------


def default_expr(coldef):
    for c in coldef.constraints or []:
        if enum_name(c.contype) == "CONSTR_DEFAULT":
            return c.raw_expr
    return coldef.raw_default


def has_identity(coldef):
    for c in coldef.constraints or []:
        if enum_name(c.contype) in ("CONSTR_IDENTITY", "CONSTR_GENERATED"):
            return enum_name(c.contype)
    return None


def column_fk_problem(coldef):
    for c in coldef.constraints or []:
        if enum_name(c.contype) != "CONSTR_FOREIGN":
            continue
        if fk_action_bad(c):
            return "cascade-or-action"
        if fk_target_auth(c):
            return "auth.users"
        if c.pktable:
            return "fk"
    return None


def classify_type_and_default(coldef, table_name, family):
    key, array, typmod = type_key_of(coldef.typeName)
    identity = has_identity(coldef)
    count_bundle = COUNT_COL.get((table_name, coldef.colname))
    if count_bundle:
        ok, _rewrite, explanation, _raw, post = BUNDLE[count_bundle]
        if ok:
            return rewritten(
                "snapback.count",
                ["ColumnDef", "CreateFunctionStmt", "CreateTrigStmt"],
                explanation,
                f"Column {coldef.colname} is a maintained integer counter, not bigint generated always as (snapback.count(…)) stored.",
            )
        return refused(
            f"Column {coldef.colname} is integer, not the §3.1 bigint spelling, and is maintained by {count_bundle}.",
            post,
        )
    if array:
        return refused(
            f"Array column {coldef.colname} ({key}[]) has no §3 column spelling.",
            "Removing a used array is refused (§7); snapback.id[] is an argument spelling, not this column.",
        )
    if key in ("json", "jsonb"):
        return refused(
            f"Column {coldef.colname} is {key}.",
            "Removing used JSON behavior is refused (§7); jsonb is not a §3 column type.",
        )
    if key in ("int2", "int4", "int", "integer", "smallint", "serial", "smallserial") or identity == "CONSTR_IDENTITY" and key == "int4":
        return refused(
            f"Column {coldef.colname} is {key}, not bigint.",
            "§3.1 spells Quarry int as bigint (53-bit). integer is not a registered alias or rewrite.",
            ambiguity="§3.1 names bigint as the SQL spelling of Quarry int and does not list integer/int4 as an alias.",
        )
    if key in ("bigserial", "serial") or identity:
        return refused(
            f"Column {coldef.colname} is {identity or key}.",
            "Identity/serial is not snapback.mint and is not per-parent snapback.sequence; "
            "the sequence-by baseline is ✗ at d9f177a434 (§3.2), so the registered sequence rewrite does not apply.",
        )
    if key in ("float4", "float8", "numeric", "decimal", "real", "money"):
        return refused(
            f"Column {coldef.colname} is {key}.",
            "Floats and numeric are refused (§3.7).",
        )
    if key in ("date", "time", "timetz", "timestamp"):
        return refused(
            f"Column {coldef.colname} is {key}.",
            "time is timestamptz of integral Unix milliseconds; date, time-of-day, and timestamp without time zone are not that spelling.",
        )
    if key == "interval":
        return refused(
            f"Column {coldef.colname} is interval.",
            "Duration values are fixed interval literals or helpers, not an interval column type in §3.1.",
        )
    if key == "uuid":
        problem = column_fk_problem(coldef)
        if family.uuid_ops:
            return refused(
                f"Column {coldef.colname} is uuid, not snapback.principal.",
                "UUID principal/id conversion is registered only when no UUID-specific operation or authority change exists. "
                f"This family has {family.uuid_op_evidence or 'a UUID-specific operation'}.",
                ambiguity="UUID-specific operations were taken at family scope when a uuid column is cast or the family contains ::uuid / gen_random_uuid.",
            )
        if problem == "cascade-or-action":
            return refused(
                f"Column {coldef.colname} is uuid with an ON DELETE/UPDATE action.",
                "Removing a used cascade or other referential action is refused (§7); snapback.principal has no ON DELETE clause.",
            )
        if problem == "auth.users":
            return refused(
                f"Column {coldef.colname} references auth.users.",
                "Rewriting it to snapback.principal would drop Supabase auth.users authority, so the UUID conversion is not applied.",
            )
        if problem == "fk":
            return refused(
                f"Column {coldef.colname} is uuid and REFERENCES another table.",
                "The principal spelling is snapback.principal not null with no references clause; dropping a used foreign key changes integrity and is not the conditional UUID rewrite.",
                ambiguity="A no-action REFERENCES clause on a uuid principal was treated as used referential behavior, not as an ignorable spelling detail.",
            )
        return rewritten(
            "uuid principal to snapback.principal",
            ["TypeName", "ColumnDef"],
            f"Column {coldef.colname} is a uuid principal with no cascade, no auth.users target, and no UUID-specific operation in this family, "
            "so it rewrites to snapback.principal.",
            "A uuid principal column is not the admitted snapback.principal spelling (§3.1).",
        )
    if key in ("varchar", "bpchar", "char"):
        return refused(
            f"Column {coldef.colname} is {key}({typmod}).",
            "§3.1 spells text <= N as text check (length(col) <= N), not varchar typmod. Argument typmods are a §3.5 rule and were not extended to columns.",
            ambiguity="§3.5 honors argument typmods such as varchar(100); §3.1's column row does not. This column was classified from the column row.",
        )
    if key not in ("text", "bool", "boolean", "int8", "bigint", "timestamptz"):
        return refused(
            f"Column {coldef.colname} has type {key}, which is not a §3.1 column spelling.",
            "No unregistered type rewrite was invented.",
        )
    # Admitted base type; judge the default.
    expr = default_expr(coldef)
    if expr is None:
        return ok_bool()
    return classify_default(expr, key)


def classify_default(expr, type_key):
    kind = node_type(expr)
    if kind == "A_Const":
        if not expr.isnull and node_type(expr.val) == "Float":
            return refused("Default is a float literal.", "Floats are refused.")
        return ok_bool()
    if kind == "FuncCall":
        name = func_name(expr)
        if name == "now" and type_key == "timestamptz":
            return ok_bool()
        if name == "clock_timestamp":
            return refused(
                "Default clock_timestamp() is refused.",
                "default now() is the admitted predicting clock; clock_timestamp is not an alias (§3.1).",
            )
        if name == "nextval":
            return refused(
                "Default nextval(sequence) is not an admitted default.",
                "The per-parent snapback.sequence rewrite requires the LLP 3000.015 baseline, which §3.2 marks ✗, and this default is a global sequence.",
            )
        if name in ("gen_random_uuid", "uuid_generate_v4"):
            return refused(
                "Default gen_random_uuid() is a UUID-specific operation.",
                "It blocks the conditional UUID conversion and is not snapback.mint on a snapback.id column as authored.",
            )
        return refused(
            f"Default calls {name}, which is not now() or a literal.",
            "Removing a used default is refused (§7) and this call is not a registered default spelling.",
        )
    if kind == "TypeCast":
        return refused(
            "Default expression is a cast.",
            "Admitted defaults are now() or literals; a cast default is not given a new rewrite.",
        )
    return refused(
        f"Default expression {kind} is not now() or a literal.",
        "No registered rewrite preserves this default.",
    )


def classify_check_expr(expr):
    if node_type(expr) == "A_Expr" and enum_name(expr.kind) == "AEXPR_IN":
        items = expr.rexpr if isinstance(expr.rexpr, (tuple, list)) else []
        if colref_parts(expr.lexpr) and items and all(node_type(i) == "A_Const" and not i.isnull for i in items):
            return Res(
                "canonicalized",
                ambiguity="check (col in (…)) is the registered alias of enum(…) (§3.7). A commented unique code is not involved.",
            )
        return refused(
            "CHECK IN is not a literal list on one column.",
            "Only check (col in (literals)) canonicalizes to enum.",
        )
    if node_type(expr) == "A_Expr" and enum_name(expr.kind) == "AEXPR_OP" and op_name(expr) == "<=":
        if is_length_of_column(expr.lexpr) and node_type(expr.rexpr) == "A_Const":
            return ok_bool()
    if node_type(expr) == "A_Expr" and enum_name(expr.kind) == "AEXPR_BETWEEN":
        if is_length_of_column(expr.lexpr):
            return ok_bool()
    if node_type(expr) == "FuncCall" and func_name(expr) == "char_length":
        return refused(
            "CHECK uses char_length, not length.",
            "§3.1's bound spelling is length(col); char_length is not a registered alias.",
            ambiguity="For text, Postgres char_length and length both count characters. Only length(col) is the §3.1 spelling, so this check was refused.",
        )
    # length buried under char_length already handled; detect char_length inside
    if contains_func(expr, "char_length"):
        return refused(
            "CHECK uses char_length, not length.",
            "§3.1's bound spelling is length(col); char_length is not a registered alias.",
            ambiguity="For text, Postgres char_length and length both count characters. Only length(col) is the §3.1 spelling, so this check was refused.",
        )
    return refused(
        "CHECK expression is not length(col) <= N, length(col) between M and N, or col in (literals).",
        "cap, format, and bytes checks are the other admitted CHECKs and this expression is none of them; ~ outside snapback.format is refused.",
    )


def is_length_of_column(node):
    return (
        node_type(node) == "FuncCall"
        and func_name(node) == "length"
        and node.args
        and len(node.args) == 1
        and colref_parts(node.args[0])
    )


def contains_func(node, name):
    if node is None or not hasattr(node, "__class__"):
        return False
    if node_type(node) == "FuncCall" and func_name(node) == name:
        return True
    for attr in ("args", "lexpr", "rexpr", "arg", "expr", "result"):
        child = getattr(node, attr, None)
        if child is None:
            continue
        if isinstance(child, (tuple, list)):
            if any(contains_func(c, name) for c in child):
                return True
        elif hasattr(child, "__class__") and contains_func(child, name):
            return True
    return False


def classify_constraint(cons, family, local_type_key=None):
    ct = enum_name(cons.contype)
    if ct in ("CONSTR_NULL", "CONSTR_NOTNULL", "CONSTR_DEFAULT", "CONSTR_IDENTITY", "CONSTR_GENERATED"):
        return None
    if ct in ("CONSTR_ATTR_DEFERRABLE", "CONSTR_ATTR_NOT_DEFERRABLE", "CONSTR_ATTR_DEFERRED", "CONSTR_ATTR_IMMEDIATE"):
        return None
    if ct == "CONSTR_PRIMARY":
        return Res(
            "admitted",
            ambiguity="PRIMARY KEY is classified as admitted uniqueness. §3.2 lists unique (…); primary key is the intrinsic-id spelling. "
            "Composite primary keys were not refused for that wording difference.",
        )
    if ct == "CONSTR_UNIQUE":
        return Res(
            "admitted",
            ambiguity="UNIQUE matches §3.2. A nullable unique column still allows multiple nulls in Postgres; that difference is not given its own class.",
        )
    if ct == "CONSTR_EXCLUSION":
        return refused("Exclusion constraints have no §3 spelling.", "No rewrite was invented.")
    if ct == "CONSTR_CHECK":
        return classify_check_expr(cons.raw_expr)
    if ct == "CONSTR_FOREIGN":
        action = fk_action_bad(cons)
        if action:
            return refused(
                f"FOREIGN KEY has referential action {action!r}.",
                "ON DELETE / ON UPDATE is refused (§3.1, §3.7). Removing a used cascade, set null, or restrict is refused (§7).",
            )
        if fk_target_auth(cons):
            return refused(
                "FOREIGN KEY targets auth.users.",
                "That is Supabase auth authority, not a snapback.id reference. Dropping it to reach snapback.principal changes authority, so it is not rewritten.",
            )
        return refused(
            "FOREIGN KEY is not the §3.1 snapback.id reference spelling.",
            "text or uuid → snapback.id is not the registered UUID-identity conversion (that conversion is principal/id only under §7's conditions, and it does not add a references clause the column does not already type as snapback.id).",
            ambiguity="A no-action REFERENCES on a text or uuid column was refused because the normative reference spelling types the column as snapback.id. "
            "The ≈ note that Snapback does not enforce existence was not read as admitting a text foreign key.",
        )
    return refused(f"Constraint {ct} has no §3 spelling.", "No rewrite was invented.")


def structural_base(if_not_exists, extra_refused=None):
    if extra_refused:
        return extra_refused
    if if_not_exists:
        return Res(
            "canonicalized",
            ambiguity="if not exists is a registered creation alias (§7). The top-level class is the worst of that alias and the non-ignored children, not the children alone.",
        )
    return ok_bool()


def table_shape_problem(stmt):
    problems = []
    if getattr(stmt, "inhRelations", None):
        problems.append("INHERITS")
    if getattr(stmt, "partspec", None) or getattr(stmt, "partbound", None):
        problems.append("PARTITION")
    if getattr(stmt, "ofTypename", None):
        problems.append("OF type")
    if getattr(stmt, "tablespacename", None):
        problems.append("TABLESPACE")
    if getattr(stmt, "accessMethod", None):
        problems.append("access method")
    if getattr(stmt, "options", None):
        problems.append("storage options")
    relp = getattr(stmt.relation, "relpersistence", "p")
    if relp and relp != "p":
        problems.append(f"relpersistence {relp}")
    if not problems:
        return None
    return refused(
        "CREATE TABLE uses " + ", ".join(problems) + ", which is not a §3 table form.",
        "No rewrite removes inheritance, partitioning, or storage options without changing the catalog.",
    )


# ---------------------------------------------------------------------------
# plpgsql
# ---------------------------------------------------------------------------


def iter_pl_statements(node, bad_exception=None):
    if not isinstance(node, dict) or len(node) != 1:
        return
    typ, val = next(iter(node.items()))
    if typ == "PLpgSQL_stmt_block":
        for child in val.get("body") or []:
            yield from iter_pl_statements(child, bad_exception)
        exc = val.get("exceptions")
        if exc:
            block = exc.get("PLpgSQL_exception_block", exc)
            for item in block.get("exc_list") or []:
                ex = item.get("PLpgSQL_exception", item)
                conds = []
                for cond in ex.get("conditions") or []:
                    conds.append(cond.get("PLpgSQL_condition", cond).get("condname"))
                handler_bad = conds if conds != ["no_data_found"] else None
                for child in ex.get("action") or []:
                    yield from iter_pl_statements(child, handler_bad if handler_bad is not None else bad_exception)
        return
    if typ == "PLpgSQL_stmt_return" and "lineno" not in val and not val.get("expr"):
        return
    yield typ, val, bad_exception
    if typ == "PLpgSQL_stmt_if":
        for child in val.get("then_body") or []:
            yield from iter_pl_statements(child, bad_exception)
        for els in val.get("elsif_list") or []:
            ev = els.get("PLpgSQL_if_elsif", els)
            for child in ev.get("stmts") or []:
                yield from iter_pl_statements(child, bad_exception)
        for child in val.get("else_body") or []:
            yield from iter_pl_statements(child, bad_exception)
    elif typ in ("PLpgSQL_stmt_fors", "PLpgSQL_stmt_fori", "PLpgSQL_stmt_foreach_a", "PLpgSQL_stmt_while", "PLpgSQL_stmt_loop", "PLpgSQL_stmt_dynfors"):
        body = val.get("body") or []
        if isinstance(body, dict):
            yield from iter_pl_statements(body, bad_exception)
        else:
            for child in body:
                yield from iter_pl_statements(child, bad_exception)


def pl_query(val, key="expr"):
    expr = val.get(key) or {}
    if "PLpgSQL_expr" in expr:
        return expr["PLpgSQL_expr"].get("query")
    if "query" in expr:
        return expr.get("query")
    return None


def parse_expr_sql(text):
    wrapped = "select (" + text + ")"
    stmt = parse_sql(wrapped)[0].stmt
    return stmt.targetList[0].val


def classify_pl_statement(typ, val, family, mode, bad_exception):
    if bad_exception is not None:
        return refused(
            f"Statement is inside exception handler {bad_exception}.",
            "Exception handlers other than no_data_found are refused (§3.6). The no_data_found handler is the NOT_FOUND shape only.",
        )
    if mode == "trigger":
        return refused(
            "Executable statement is in a trigger function that is not the §3.3 transition body.",
            "Triggers other than that transition form are refused unless a named counter/window bundle preserves behavior (§7).",
        )
    if mode == "do":
        return refused(
            f"{typ} is inside a top-level DO.",
            "DO is not a declared operation (§7). Moving the body into a function is not an unregistered escape.",
        )
    if typ == "PLpgSQL_stmt_if":
        merged = ok_bool()
        queries = []
        if val.get("cond"):
            queries.append(pl_query(val, "cond"))
        for els in val.get("elsif_list") or []:
            ev = els.get("PLpgSQL_if_elsif", els)
            queries.append(pl_query(ev, "cond"))
        for query in queries:
            if not query:
                merged = merged.merge(refused("IF has no condition text.", "No rewrite is registered."))
                continue
            try:
                expr = parse_expr_sql(query)
            except Exception as exc:
                merged = merged.merge(refused(f"IF condition did not parse: {exc}", "Unparsed conditions are refused."))
                continue
            merged = merged.merge(check_expr(expr, Scope(family), True))
        return merged
    if typ == "PLpgSQL_stmt_assign":
        query = pl_query(val)
        if not query:
            return refused("Assignment has no expression.", "No rewrite is registered.")
        rhs = query.split(":=", 1)[1].strip() if ":=" in query else query
        try:
            expr = parse_expr_sql(rhs)
        except Exception as exc:
            return refused(f"Assignment RHS did not parse: {exc}", "Unparsed assignments are refused.")
        return check_expr(expr, Scope(family), False)
    if typ == "PLpgSQL_stmt_return":
        query = pl_query(val)
        if not query:
            return ok_bool()
        try:
            expr = parse_expr_sql(query)
        except Exception as exc:
            return refused(f"RETURN expression did not parse: {exc}", "Unparsed returns are refused.")
        return check_expr(expr, Scope(family), False)
    if typ == "PLpgSQL_stmt_return_query":
        query = pl_query(val, "query")
        if not query:
            return refused("RETURN QUERY has no query.", "No rewrite is registered.")
        try:
            stmts = parse_sql(query)
        except Exception as exc:
            return refused(f"RETURN QUERY did not parse: {exc}", "Unparsed return query is refused.")
        if len(stmts) != 1:
            return refused("RETURN QUERY contains more than one SQL statement.", "That is not a terminal page.")
        return classify_select_exec(stmts[0].stmt, family, as_page=True)
    if typ == "PLpgSQL_stmt_return_next":
        return refused(
            "RETURN NEXT accumulates a result.",
            "Accumulating return query/next is refused (§3.5).",
        )
    if typ == "PLpgSQL_stmt_execsql":
        query = pl_query(val, "sqlstmt")
        if not query:
            return refused("SQL statement has no text.", "No rewrite is registered.")
        try:
            stmts = parse_sql(query)
        except Exception as exc:
            return refused(f"Body SQL did not parse: {exc}", "Unparsed body SQL is refused.")
        if len(stmts) != 1:
            return refused(
                "Body SQL node contains more than one statement.",
                "Statements are counted from the plpgsql AST, not by splitting on semicolons; a multi-statement execsql is refused.",
            )
        return classify_sql_statement(stmts[0].stmt, family, mode)
    if typ == "PLpgSQL_stmt_perform":
        query = pl_query(val)
        if query and "snapback.emit" in query.replace(" ", "").lower():
            try:
                stmts = parse_sql(query if query.lower().startswith("select") else "select " + query)
                expr = stmts[0].stmt.targetList[0].val
            except Exception as exc:
                return refused(f"PERFORM did not parse: {exc}", "Unparsed PERFORM is refused.")
            if node_type(expr) == "FuncCall" and func_name(expr) == "snapback.emit":
                return check_func(expr, Scope(family), False)
        return refused(
            "PERFORM is admitted only for snapback.emit.",
            "Other PERFORM targets are refused (§3.6).",
        )
    if typ == "PLpgSQL_stmt_fors":
        query = pl_query(val, "query")
        if not query:
            return refused("FOR query loop has no query.", "No rewrite is registered.")
        try:
            stmts = parse_sql(query)
        except Exception as exc:
            return refused(f"FOR query did not parse: {exc}", "Unparsed loops are refused.")
        if len(stmts) != 1:
            return refused("FOR query is not a single select.", "No rewrite is registered.")
        sel = stmts[0].stmt
        if node_type(sel) != "SelectStmt":
            return refused("FOR loop query is not a select.", "for r in <planned select> is the admitted loop.")
        result = classify_select_exec(sel, family, as_page=False)
        if result.cls == "refused" and "not a full-key" in (result.raw or ""):
            # A sweep select need not be a point read. Re-check only structural bans and expressions.
            return for_loop_select(sel, family)
        if result.cls == "refused":
            return result
        result.ambiguity = join_reason(
            result.ambiguity,
            "for r in <planned select> was admitted when the select has no CTE, window, or refused expression; joins were not further banned.",
        )
        return result
    if typ == "PLpgSQL_stmt_fori":
        merged = ok_bool()
        for bound in ("lower", "upper"):
            query = pl_query(val, bound)
            if not query:
                continue
            try:
                expr = parse_expr_sql(query)
            except Exception as exc:
                return refused(f"FOR i bound did not parse: {exc}", "Unparsed bounds are refused.")
            merged = merged.merge(check_expr(expr, Scope(family), False))
        if merged.cls == "admitted":
            merged.ambiguity = "for i in a..b is the inclusive spelling and is lowered as written (§3.6), not as Quarry range."
        return merged
    if typ == "PLpgSQL_stmt_foreach_a":
        query = pl_query(val)
        if not query:
            return refused("FOREACH has no array expression.", "No rewrite is registered.")
        try:
            expr = parse_expr_sql(query)
        except Exception as exc:
            return refused(f"FOREACH expression did not parse: {exc}", "Unparsed FOREACH is refused.")
        return check_expr(expr, Scope(family), False)
    if typ in ("PLpgSQL_stmt_exit",):
        # continue is stmt_exit without is_exit in this libpg_query build.
        return ok_bool()
    if typ == "PLpgSQL_stmt_raise":
        level = val.get("elog_level", 21)
        if level < 20:
            return refused(
                f"RAISE level {level} is not exception.",
                "Only raise exception 'CODE' is admitted; NOTICE and WARNING are not.",
            )
        if val.get("params") or val.get("options"):
            return refused(
                "RAISE with format parameters or USING options is not raise exception 'CODE'.",
                "No rewrite turns a formatted raise into a fixed application code.",
            )
        if not val.get("message"):
            return refused("RAISE has no message code.", "require else CODE needs a code.")
        return ok_bool()
    if typ == "PLpgSQL_stmt_while" or typ == "PLpgSQL_stmt_loop":
        return refused(
            f"{typ} is not an admitted loop.",
            "Admitted loops are for r in select, for i in a..b, and foreach (§3.6).",
        )
    if typ == "PLpgSQL_stmt_dynexecute" or typ == "PLpgSQL_stmt_dynfors":
        return refused(
            "EXECUTE / dynamic FOR is refused.",
            "execute has no behavior-preserving rewrite in §3.6.",
        )
    if typ in ("PLpgSQL_stmt_commit", "PLpgSQL_stmt_rollback"):
        return refused(
            "COMMIT/ROLLBACK inside a routine is not an admitted statement.",
            "Transaction control is not part of the job/mutation grammar.",
        )
    if typ == "PLpgSQL_stmt_getdiag":
        return refused(
            "GET DIAGNOSTICS is not an admitted statement.",
            "row_count and similar diagnostics have no §3.6 spelling.",
        )
    if typ in ("PLpgSQL_stmt_open", "PLpgSQL_stmt_fetch", "PLpgSQL_stmt_close"):
        return refused(
            "Cursors are refused (§3.6).",
            "No rewrite replaces an explicit cursor.",
        )
    if typ == "PLpgSQL_stmt_case":
        return refused(
            "PL/pgSQL CASE is not the admitted if/elsif spelling.",
            "case when is an expression spelling, not this statement.",
        )
    return refused(
        f"PL/pgSQL node {typ} is outside the finite grammar.",
        "No unregistered statement class was invented.",
    )


def walk_ast(node, seen=None):
    if seen is None:
        seen = set()
    if node is None or isinstance(node, (str, int, float, bool, bytes)):
        return
    if isinstance(node, (list, tuple)):
        for item in node:
            yield from walk_ast(item, seen)
        return
    ident = id(node)
    if ident in seen:
        return
    slots = getattr(type(node), "__slots__", None)
    if not slots:
        return
    seen.add(ident)
    yield node
    for name in slots:
        if not isinstance(name, str) or name.startswith("_"):
            continue
        try:
            child = getattr(node, name)
        except Exception:
            continue
        yield from walk_ast(child, seen)


def forbidden_call(node):
    if node_type(node) != "FuncCall":
        return None
    if node.over or node.agg_distinct:
        return func_name(node)
    name = func_name(node)
    if name in ALLOWED_FUNCS or name == "auth.uid":
        return None
    if name.startswith("snapback.") and name.split(".", 1)[1] in SNAPBACK_FUNCS:
        return None
    return name


def for_loop_select(sel, family):
    if sel.withClause or sel.windowClause or sel.lockingClause or (sel.op and not sel.all):
        return refused(
            "FOR query uses a CTE, window, lock, or UNION distinct.",
            "Those are refused inside a planned select.",
        )
    for node in walk_ast(sel):
        bad = forbidden_call(node)
        if bad:
            return refused(
                f"FOR query calls {bad}, which is not an admitted function.",
                "A planned select may not hide a refused call in FROM or a projection; no rewrite is registered.",
            )
    scope = scope_from(sel.fromClause, family)
    merged = ok_bool()
    for target in sel.targetList or []:
        if colref_parts(target.val) == ["*"]:
            continue
        merged = merged.merge(check_expr(target.val, scope, False))
    if sel.whereClause:
        merged = merged.merge(check_expr(sel.whereClause, scope, True))
    if merged.cls != "refused":
        merged.ambiguity = join_reason(
            merged.ambiguity,
            "A for-loop select that is not a point read was still admitted as §3.6's planned select when its expressions are in the subset.",
        )
    return merged


def override_bundle(res, bundle_name):
    ok, rewrite, explanation, raw, post = BUNDLE[bundle_name]
    if ok:
        return rewritten(rewrite, ["CreateFunctionStmt", "CreateTrigStmt", "ColumnDef"], explanation, raw)
    return refused(raw, post)


# ---------------------------------------------------------------------------
# Statement drivers
# ---------------------------------------------------------------------------


def classify_signature(stmt, family, bundle_name):
    if bundle_name:
        return override_bundle(Res("refused"), bundle_name)
    lang, vol, sec, body = func_options(stmt)
    name = qname(stmt.funcname)
    defects = []
    ambiguities = []
    returns_trigger = False
    if stmt.returnType is not None:
        rkey, rarray, _ = type_key_of(stmt.returnType)
        returns_trigger = rkey == "trigger"
        if rarray:
            defects.append(f"return type {rkey}[] is an array")
        elif rkey == "trigger":
            pass
        elif rkey in ("void", "bool", "boolean", "int8", "bigint", "text", "timestamptz", "record"):
            pass
        elif rkey in ("int2", "int4", "integer", "serial"):
            defects.append(f"return type {rkey} is not bigint")
            ambiguities.append("Return integer was refused because §3.1 spells int as bigint.")
        elif rkey in ("json", "jsonb"):
            defects.append(f"return type {rkey} is JSON")
        elif rkey == "uuid":
            defects.append("return type uuid is not snapback.principal")
        else:
            defects.append(f"return type {rkey} is not a §3 type")
    input_params = []
    out_params = []
    for param in stmt.parameters or []:
        mode = enum_name(param.mode)
        if mode in ("FUNC_PARAM_TABLE", "FUNC_PARAM_OUT"):
            out_params.append(param)
        else:
            input_params.append(param)
    for param in input_params + out_params:
        if param.argType is None:
            continue
        key, array, typmod = type_key_of(param.argType)
        label = param.name or key
        if array and key != "text":
            # snapback.id[] would be the id domain, which is not authored.
            defects.append(f"parameter {label} is {key}[]")
        elif array and key == "text":
            defects.append(f"parameter {label} is text[]")
        elif key == "uuid":
            if family.uuid_ops:
                defects.append(f"parameter {label} is uuid and the family has a UUID-specific operation")
            else:
                # Successful principal rewrite of a parameter is recorded as a defect-free rewrite later.
                pass
        elif key in ("json", "jsonb"):
            defects.append(f"parameter {label} is {key}")
        elif key in ("int2", "int4", "integer", "serial"):
            defects.append(f"parameter {label} is {key}, not bigint")
            ambiguities.append("Argument integer was refused because §3.1 spells int as bigint; varchar typmod is the only extra argument-type rule.")
        elif key in ("varchar", "bpchar") and typmod:
            # §3.5 honors argument typmods.
            pass
        elif key in ("float4", "float8", "numeric", "date", "time", "timestamp"):
            defects.append(f"parameter {label} is {key}")
        elif key not in ("text", "bool", "boolean", "int8", "bigint", "timestamptz", "void", "record", "varchar", "bpchar"):
            defects.append(f"parameter {label} has type {key}")
    has_uuid_param = any(
        param.argType is not None and type_key_of(param.argType)[0] == "uuid"
        for param in input_params + out_params
    )
    uuid_param_rewrite = not defects and not family.uuid_ops and has_uuid_param
    is_probe = name in family.helpers
    if returns_trigger:
        raw = "Trigger function is not the §3.3 transition form."
        post = "It is not one of the named counter/window bundles with a behavior-preserving snapback.count or fixed-interval raise rewrite."
        return refused(raw, post)
    if stmt.is_procedure:
        # Filled in by the caller once the body is known; provisional, body may refuse.
        base = ok_bool()
    elif sec and not is_probe:
        defects.append("security definer is admitted only for a language-sql stable helper whose body is exactly a probe")
    if is_probe and not defects and not family.uuid_ops:
        extra = ""
        nodes = ["CreateFunctionStmt", "SubLink"]
        rewrite = "inline admitted probe helper"
        if uuid_param_rewrite:
            rewrite = "inline admitted probe helper; uuid principal to snapback.principal"
            nodes = ["CreateFunctionStmt", "SubLink", "FunctionParameter", "TypeName"]
            extra = " UUID arguments rewrite to snapback.principal."
        return rewritten(
            rewrite,
            nodes,
            f"Inline {name}: its body is exactly a full-key exists probe, so policies and the helper lower by inlining (§3.3)."
            + extra,
            f"{name} is a security-definer helper rather than the inlined exists probe.",
            ambiguity="create or replace is a creation alias and is dominated by the inline rewrite.",
        )
    if vol == "stable" and lang == "sql" and not is_probe and not stmt.is_procedure:
        # May still be a query. Defects already collected.
        pass
    if lang == "sql" and vol == "volatile" and not stmt.is_procedure:
        defects.append("volatile language-sql is not a mutation (mutations are plpgsql) or a stable query")
    if lang not in ("sql", "plpgsql"):
        defects.append(f"language {lang} is not sql or plpgsql")
    if defects:
        raw = "Signature is not an admitted routine spelling: " + "; ".join(defects) + "."
        post = (
            "security definer has no preserving rewrite except exact probe inlining; "
            "uuid parameters rewrite to snapback.principal only when the family has no UUID-specific operation; "
            "json, integer, and array parameters have no registered rewrite."
        )
        return refused(raw, post, ambiguity=" ".join(dict.fromkeys(ambiguities)) or None)
    if uuid_param_rewrite:
        return rewritten(
            "uuid principal to snapback.principal",
            ["FunctionParameter", "TypeName"],
            "UUID routine arguments rewrite to snapback.principal because this family has no UUID-specific operation and the arguments are principals.",
            "UUID arguments are not the admitted snapback.principal spelling.",
        )
    if is_probe:
        return rewritten(
            "inline admitted probe helper",
            ["CreateFunctionStmt", "SubLink"],
            f"Inline {name}: its body is exactly a full-key exists probe.",
            f"{name} is a security-definer helper rather than the inlined exists probe.",
        )
    if stmt.replace:
        return Res(
            "canonicalized",
            ambiguity="create or replace is a registered creation alias (§7) and the rest of the signature matches a routine kind.",
        )
    return ok_bool()


def sql_body_units(body, family, function_name):
    if function_name == "ns_feed":
        return [
            refused(
                "feed's body is one SQL statement with CTEs (scope, orig, repo, stream), UNION ALL, a keyset predicate on before_ts/before_id, and a viewer parameter.",
                "Following + page + shape does not preserve it: posts are not published (no snapback.publish; admission needs published public sources), "
                "author columns are not snapback.immutable while post_upd allows the author to update the row, tab = 'global' is not Following, "
                "a user-supplied viewer is not auth.uid() without an authorization change, and a keyset predicate is refused. CTE removal alone is not equivalence.",
            )
        ]
    try:
        stmts = parse_sql(body)
    except Exception as exc:
        return [refused(f"SQL function body did not parse: {exc}", "Unparsed bodies are refused.")]
    if function_name in family.helpers:
        return [
            rewritten(
                "inline admitted probe helper",
                ["SelectStmt", "SubLink"],
                f"The body is the full-key probe that {function_name} inlines, including residual null tests or equalities when present.",
                "The helper body is a security-definer SELECT rather than the probe written at the policy.",
            )
        ]
    out = []
    for raw in stmts:
        out.append(
            classify_sql_statement(raw.stmt, family, "query").merge(
                refused(
                    "Language-sql body is not a registered page, shape, probe helper, or streamed aggregate spelling.",
                    "Stable SQL that does not match §3.4–§3.5 is an unsupported routine (§3.5). CTEs, keyset predicates, and security-definer wrappers are not rewritten away.",
                )
            )
            if False
            else _sql_function_body_stmt(raw.stmt, family)
        )
    return out


def _sql_function_body_stmt(stmt, family):
    """Language-sql function bodies are queries or probe helpers, not mutation DML."""
    kind = node_type(stmt)
    if kind == "SelectStmt" and stmt.withClause:
        return refused(
            "SQL function body is a CTE.",
            "CTEs are refused (§3.7). CTE removal is not equivalence, and this body is not the registered Following rewrite (that rewrite is the named feed instance only).",
        )
    if kind in ("UpdateStmt", "InsertStmt", "DeleteStmt"):
        return refused(
            f"Language-sql function body is {kind}.",
            "A volatile SQL statement is not a plpgsql mutation and not a stable query; set-based DML stays refused.",
        )
    probed = classify_sql_statement(stmt, family, "page")
    if probed.cls == "refused":
        return refused(
            probed.raw or "SQL function body does not match a registered query spelling.",
            "Stable SQL/plpgsql that is not a page, shape, point read, or probe helper is refused (§3.5). "
            + (probed.post or ""),
            ambiguity=probed.ambiguity,
        )
    return probed


def routine_body(stmt, family, source_slice, bundle_name):
    lang, _vol, _sec, body = func_options(stmt)
    name = qname(stmt.funcname)
    if bundle_name:
        ok, _rewrite, _explanation, raw, post = BUNDLE[bundle_name]
        # Still enumerate real statement nodes so the body denominator is the AST.
        nodes = []
        if lang == "plpgsql" and source_slice:
            try:
                parsed = json.loads(parse_plpgsql_json(source_slice))
            except Exception:
                parsed = []
            for fn in parsed:
                action = fn.get("PLpgSQL_function", {}).get("action")
                if action:
                    nodes.extend(iter_pl_statements(action))
        if not nodes:
            nodes = [("PLpgSQL_stmt_block", {}, None)]
        out = []
        for typ, _val, _bad in nodes:
            if ok:
                out.append(
                    (
                        pl_kind(typ),
                        rewritten(
                            "snapback.count",
                            [typ, "CreateFunctionStmt", "CreateTrigStmt"],
                            "This trigger statement is replaced, together with the bundle, by the generated snapback.count column.",
                            raw,
                        ),
                    )
                )
            else:
                out.append((pl_kind(typ), refused(raw, post)))
        return out
    if lang == "sql":
        return [("sql_body", item) for item in sql_body_units(body or "", family, name)]
    if lang != "plpgsql":
        return [("sql_body", refused(f"Language {lang} has no body grammar in §3.", "No rewrite was invented."))]
    mode = "trigger" if stmt.returnType is not None and type_key_of(stmt.returnType)[0] == "trigger" else "mutation"
    if stmt.is_procedure:
        mode = "mutation"
    try:
        parsed = json.loads(parse_plpgsql_json(source_slice))
    except Exception as exc:
        return [("plpgsql_other", refused(f"plpgsql parser failed: {exc}", "The body cannot be admitted without its statement nodes."))]
    out = []
    for fn in parsed:
        action = fn.get("PLpgSQL_function", {}).get("action")
        if not action:
            continue
        for typ, val, bad in iter_pl_statements(action):
            out.append((pl_kind(typ), classify_pl_statement(typ, val, family, mode, bad)))
    return out


def pl_kind(typ):
    mapping = {
        "PLpgSQL_stmt_if": "plpgsql_if",
        "PLpgSQL_stmt_assign": "plpgsql_assign",
        "PLpgSQL_stmt_return": "plpgsql_return",
        "PLpgSQL_stmt_return_query": "plpgsql_return_query",
        "PLpgSQL_stmt_return_next": "plpgsql_return_next",
        "PLpgSQL_stmt_execsql": "plpgsql_execsql",
        "PLpgSQL_stmt_perform": "plpgsql_perform",
        "PLpgSQL_stmt_fors": "plpgsql_for",
        "PLpgSQL_stmt_fori": "plpgsql_fori",
        "PLpgSQL_stmt_foreach_a": "plpgsql_foreach",
        "PLpgSQL_stmt_while": "plpgsql_while",
        "PLpgSQL_stmt_loop": "plpgsql_loop",
        "PLpgSQL_stmt_exit": "plpgsql_exit",
        "PLpgSQL_stmt_raise": "plpgsql_raise",
        "PLpgSQL_stmt_commit": "plpgsql_commit",
        "PLpgSQL_stmt_rollback": "plpgsql_rollback",
        "PLpgSQL_stmt_getdiag": "plpgsql_getdiag",
        "PLpgSQL_stmt_dynexecute": "plpgsql_dynexecute",
        "PLpgSQL_stmt_dynfors": "plpgsql_dynfors",
        "PLpgSQL_stmt_open": "plpgsql_open",
        "PLpgSQL_stmt_fetch": "plpgsql_fetch",
        "PLpgSQL_stmt_close": "plpgsql_close",
        "PLpgSQL_stmt_case": "plpgsql_case",
    }
    return mapping.get(typ, "plpgsql_other")


def do_body(source_slice, family):
    try:
        parsed = json.loads(parse_plpgsql_json(source_slice))
    except Exception as exc:
        return [("plpgsql_other", refused(f"DO body did not parse: {exc}", "DO remains a refused migration script."))]
    out = []
    for fn in parsed:
        action = fn.get("PLpgSQL_function", {}).get("action")
        if not action:
            continue
        for typ, val, bad in iter_pl_statements(action):
            out.append((pl_kind(typ), classify_pl_statement(typ, val, family, "do", bad)))
    return out


def classify_index(stmt, family):
    names, exprs = index_colnames(stmt)
    method = (stmt.accessMethod or "btree").lower()
    table = family.tables.get(stmt.relation.relname)
    partial = stmt.whereClause is not None
    if exprs or method not in ("btree",):
        return refused(
            f"Index {stmt.idxname} is a {method} expression or non-btree index.",
            "Deletion would drop this search structure. snapback.search is word-prefix on named columns, not to_tsvector/GIN, so it does not preserve the index. "
            "The performance-only deletion rewrite is not recorded because a search dependency would be lost.",
        )
    if stmt.unique:
        key = tuple(n for n in names if n)
        redundant = (not partial) and table is not None and key in table.unique_keys
        # The unique index itself was added to unique_keys during prepass, so it always
        # appears there. Redundant means some OTHER constraint already has the same key.
        others = [k for k in (table.unique_keys if table else []) if k == key]
        # unique_keys contains this index. A table constraint of the same columns is not
        # distinguishable after prepass. Treat every unique index as the uniqueness
        # mechanism unless a primary key or unique constraint of the same columns was
        # declared on the table (stored separately).
        if table and key in table.constraint_keys and not partial:
            return rewritten(
                "delete redundant performance-only index",
                ["IndexStmt"],
                f"Delete {stmt.idxname}; uniqueness of {key} remains on a table constraint, the index is not word search, and no named merge lane references it.",
                "create index is refused as authored (§7).",
            )
        return refused(
            f"Unique index {stmt.idxname} is refused as authored.",
            "The only index rewrite is deletion of a redundant performance-only index after recording that uniqueness is not lost. "
            "Deleting this index would drop its uniqueness"
            + (" (the predicate is partial)" if partial else "")
            + ", and converting a unique index into a table UNIQUE constraint is not the registered rewrite.",
            ambiguity="§3.2 admits unique (…) as a constraint. A non-partial unique index has the same catalog effect, but §7's index row does not register that conversion.",
        )
    covered = ", ".join(n or "?" for n in names)
    where = " partial" if partial else ""
    return rewritten(
        "delete redundant performance-only index",
        ["IndexStmt"],
        f"Delete{where} btree {stmt.idxname} on ({covered}); it is not unique, not a word-search index, and not a named merge dependency, so the planner's choice replaces it.",
        "create index is refused as authored (§7).",
    )


def mark_constraint_keys(family, stmt):
    """Remember uniqueness that comes from table constraints, not indexes."""
    if node_type(stmt) == "CreateStmt":
        table = family.table(stmt.relation.relname)
        for el in stmt.tableElts or []:
            if node_type(el) == "ColumnDef":
                for c in el.constraints or []:
                    if enum_name(c.contype) in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
                        keys = tuple(sval_list(c.keys) or [el.colname])
                        table.constraint_keys.append(keys)
            elif node_type(el) == "Constraint" and enum_name(el.contype) in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
                table.constraint_keys.append(tuple(sval_list(el.keys)))
    elif node_type(stmt) == "AlterTableStmt":
        table = family.table(stmt.relation.relname)
        for cmd in stmt.cmds or []:
            if enum_name(cmd.subtype) == "AT_AddConstraint" and cmd.def_ is not None:
                if enum_name(cmd.def_.contype) in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
                    table.constraint_keys.append(tuple(sval_list(cmd.def_.keys)))


def init_constraint_keys(family):
    for table in family.tables.values():
        table.constraint_keys = []


# ---------------------------------------------------------------------------
# File walk
# ---------------------------------------------------------------------------


def load_sources():
    loaded = []
    for path in FILES:
        original = (CORPUS / path).read_text()
        substituted = original.replace("{{P}}", "ns_")
        stmts = parse_sql(substituted)
        loaded.append((path, original, substituted, stmts))
    return loaded


def build_families(loaded):
    families = {name: Family(name) for name in FAMILIES}
    by_file = {path: (original, substituted, stmts) for path, original, substituted, stmts in loaded}
    for name, paths in FAMILIES.items():
        family = families[name]
        init_done = False
        for path in paths:
            _o, _s, stmts = by_file[path]
            for raw in stmts:
                prepass_statement(family, raw.stmt)
        init_constraint_keys(family)
        for path in paths:
            _o, substituted, stmts = by_file[path]
            for raw in stmts:
                mark_constraint_keys(family, raw.stmt)
            scan_uuid_ops(family, substituted)
        # Helpers are registered in prepass before uuid scan; re-register is unnecessary.
        _ = init_done
    return families


def emit_children(file, index, children):
    units = []
    classes = []
    for j, (kind, res) in enumerate(children):
        units.append(unit_dict(f"{file}:{index}:{j}", file, kind, res))
        if res.cls != "ignored":
            classes.append(res.cls)
    return units, classes


def top_from_children(base, child_classes, child_units):
    classes = [base.cls] + child_classes
    cls = worst(classes)
    if cls == base.cls and cls in ("admitted", "canonicalized", "ignored"):
        return base
    # Prefer a child result of the winning class for the explanation.
    winner = None
    for unit_res in child_units:
        if unit_res.cls == cls:
            winner = unit_res
            break
    if winner is None:
        return base
    if cls == "refused":
        return refused(
            "Worst non-ignored child is refused. " + (winner.raw or ""),
            "Top-level class follows that child (§7). " + (winner.post or ""),
            ambiguity=winner.ambiguity,
        )
    if cls == "rewritten":
        return rewritten(
            winner.rewrite,
            winner.nodes,
            "Top-level class follows the worst child. " + (winner.explanation or ""),
            "Worst non-ignored child is not an admitted spelling. " + (winner.raw or ""),
            ambiguity=winner.ambiguity,
        )
    if cls == "canonicalized":
        return Res("canonicalized", ambiguity=winner.ambiguity or base.ambiguity)
    return ok_bool()


def classify_loaded(loaded, families):
    units = []
    for path, _original, substituted, stmts in loaded:
        family = families[path.split("/")[0]]
        for index, raw in enumerate(stmts):
            stmt = raw.stmt
            kind = node_type(stmt)
            slice_sql = ""
            if raw.stmt_location is not None and raw.stmt_len:
                slice_sql = substituted[raw.stmt_location : raw.stmt_location + raw.stmt_len]
            produced = classify_top(path, index, stmt, kind, slice_sql, family)
            units.extend(produced)
    return units


def column_children(table_name, coldef, family):
    children = [("column", classify_type_and_default(coldef, table_name, family))]
    for cons in coldef.constraints or []:
        res = classify_constraint(cons, family)
        if res is not None:
            children.append(("constraint", res))
    return children


def classify_top(path, index, stmt, kind, slice_sql, family):
    file = path
    if kind == "CreateStmt":
        children = []
        for el in stmt.tableElts or []:
            if node_type(el) == "ColumnDef":
                children.extend(column_children(stmt.relation.relname, el, family))
            elif node_type(el) == "Constraint":
                res = classify_constraint(el, family)
                if res is not None:
                    children.append(("constraint", res))
        base = structural_base(bool(stmt.if_not_exists), table_shape_problem(stmt))
        return finish_parent(file, index, "create_table", base, children)
    if kind == "AlterTableStmt":
        return classify_alter(file, index, stmt, family)
    if kind == "IndexStmt":
        return [unit_dict(f"{file}:{index}", file, "index", classify_index(stmt, family))]
    if kind == "CreatePolicyStmt":
        return [unit_dict(f"{file}:{index}", file, "policy", classify_policy(stmt, family))]
    if kind == "CreateTrigStmt":
        fname = qname(stmt.funcname)
        if fname in BUNDLE:
            res = override_bundle(Res("refused"), fname)
        else:
            res = refused(
                f"Trigger {stmt.trigname} is not the §3.3 transition form.",
                "Only the named counter and window bundles may be rewritten, and only when the rewrite preserves behavior. This trigger is not one of them.",
            )
        return [unit_dict(f"{file}:{index}", file, "trigger", res)]
    if kind == "CreateFunctionStmt":
        return classify_routine(file, index, stmt, slice_sql, family)
    if kind == "CreateSeqStmt":
        res = refused(
            "create sequence is not per-parent snapback.sequence(parent).",
            "The registered sequence rewrite also requires the LLP 3000.015 baseline, which §3.2 marks ✗ at d9f177a434. if not exists does not admit a refused sequence.",
            ambiguity="if not exists is a creation alias for objects §3 admits. It was not applied to canonicalize a sequence the sequence row refuses.",
        )
        return [unit_dict(f"{file}:{index}", file, "sequence", res)]
    if kind == "CreateExtensionStmt":
        res = refused(
            f"Extension {stmt.extname} is not ignored dependency boilerplate.",
            "Only extensions that supply UUID generation alone, or cron names, are ignored. pgcrypto supplies more than UUID generation, and this corpus does not limit it to gen_random_uuid.",
            ambiguity="§7 ignores an extension supplying only UUID generation. pgcrypto can supply gen_random_uuid, but it is a general crypto extension and no call site in the frozen corpus shows that it is used only for that.",
        )
        return [unit_dict(f"{file}:{index}", file, "extension", res)]
    if kind == "DoStmt":
        children = do_body(slice_sql, family)
        parent = refused(
            "Top-level DO is not a declared operation.",
            "Migration scripts are refused (§7). Moving the block into a function is not an unregistered escape.",
        )
        units = [unit_dict(f"{file}:{index}", file, "do", parent)]
        child_units, _ = emit_children(file, index, children)
        units.extend(child_units)
        return units
    if kind == "DropStmt":
        if stmt.missing_ok:
            res = Res("ignored")
        else:
            res = refused(
                "DROP without IF EXISTS is not boilerplate.",
                "The boilerplate row is drop … if exists. A bare drop of a live object is refused.",
            )
        return [unit_dict(f"{file}:{index}", file, "drop", res)]
    if kind == "GrantStmt":
        return [unit_dict(f"{file}:{index}", file, "grant", Res("ignored"))]
    if kind == "TransactionStmt":
        tkind = enum_name(stmt.kind)
        if tkind in ("TRANS_STMT_BEGIN", "TRANS_STMT_START", "TRANS_STMT_COMMIT"):
            res = Res("ignored")
        else:
            res = refused(
                f"Transaction statement {tkind} is not BEGIN/COMMIT boilerplate.",
                "No rewrite admits other transaction control as a declared operation.",
            )
        return [unit_dict(f"{file}:{index}", file, "transaction", res)]
    if kind == "LockStmt":
        return [
            unit_dict(
                f"{file}:{index}",
                file,
                "lock",
                refused(
                    "LOCK TABLE is not a declared operation.",
                    "Migration/data scripts are refused (§7).",
                ),
            )
        ]
    if kind == "AlterPublicationStmt":
        return [
            unit_dict(
                f"{file}:{index}",
                file,
                "alter_publication",
                refused(
                    "ALTER PUBLICATION … ADD TABLE enrolls Supabase Realtime.",
                    "The residency rewrite is snapback.publish only when the audience matches an invertible read rule. Realtime enrollment is not that audience (§7).",
                ),
            )
        ]
    if kind == "VariableSetStmt":
        if stmt.name == "search_path":
            return [unit_dict(f"{file}:{index}", file, "set", Res("ignored"))]
        return [
            unit_dict(
                f"{file}:{index}",
                file,
                "set",
                refused(f"SET {stmt.name} is not search_path boilerplate.", "Other SET statements are refused."),
            )
        ]
    if kind in ("InsertStmt", "UpdateStmt", "DeleteStmt", "SelectStmt"):
        if kind == "SelectStmt" and is_setval(stmt):
            skind, raw = "setval", "setval is not a declared operation."
        elif kind == "UpdateStmt" and stmt.withClause:
            skind, raw = "update", "Top-level CTE UPDATE is not a declared operation."
        elif kind == "InsertStmt":
            skind, raw = "insert", "Top-level INSERT is not a declared operation."
        elif kind == "UpdateStmt":
            skind, raw = "update", "Top-level UPDATE is not a declared operation."
        elif kind == "DeleteStmt":
            skind, raw = "delete", "Top-level DELETE is not a declared operation."
        else:
            skind, raw = "select", "Top-level SELECT is not a declared operation."
        return [
            unit_dict(
                f"{file}:{index}",
                file,
                skind,
                refused(raw, "Migration/data scripts are refused (§7). Moving the statement into a function is not an unregistered escape."),
            )
        ]
    return [
        unit_dict(
            f"{file}:{index}",
            file,
            "other",
            refused(
                f"Statement {kind} is not in the §7 kind table.",
                "Every other kind is refused; no unregistered class was invented.",
            ),
        )
    ]


def is_setval(stmt):
    if not stmt.targetList or len(stmt.targetList) != 1:
        return False
    val = stmt.targetList[0].val
    return node_type(val) == "FuncCall" and func_name(val) == "setval"


def finish_parent(file, index, kind, base, children):
    child_units_res = [res for _k, res in children]
    child_classes = [res.cls for res in child_units_res if res.cls != "ignored"]
    parent = top_from_children(base, child_classes, child_units_res)
    # If base is canonicalized and children are only admitted, top_from_children
    # returns base because worst includes base. Good.
    # If a child is worse, parent becomes that child. Also keep base ambiguity when it changed nothing.
    if parent.cls == base.cls and base.ambiguity and not parent.ambiguity:
        parent.ambiguity = base.ambiguity
    units = [unit_dict(f"{file}:{index}", file, kind, parent)]
    units.extend(emit_children(file, index, children)[0])
    return units


def classify_alter(file, index, stmt, family):
    subs = [enum_name(cmd.subtype) for cmd in (stmt.cmds or [])]
    if subs and set(subs) == {"AT_EnableRowSecurity"}:
        return [unit_dict(f"{file}:{index}", file, "enable_rls", ok_bool())]
    if subs == ["AT_ReplicaIdentity"]:
        return [
            unit_dict(
                f"{file}:{index}",
                file,
                "alter_replica_identity",
                refused(
                    "REPLICA IDENTITY has no §3 catalog form.",
                    "It is not snapback residency. Publication rewrite requires a matching audience, not Realtime replica identity.",
                ),
            )
        ]
    children = []
    if_not_exists = False
    extra = None
    kind_name = "alter_other"
    for cmd in stmt.cmds or []:
        sub = enum_name(cmd.subtype)
        if sub == "AT_AddColumn":
            kind_name = "alter_add_column"
            if_not_exists = if_not_exists or bool(cmd.missing_ok)
            children.extend(column_children(stmt.relation.relname, cmd.def_, family))
        elif sub == "AT_AddConstraint":
            kind_name = "alter_add_constraint"
            res = classify_constraint(cmd.def_, family)
            if res is not None:
                children.append(("constraint", res))
        elif sub == "AT_DropConstraint":
            kind_name = "alter_drop_constraint"
            children.append(
                (
                    "constraint",
                    refused(
                        f"DROP CONSTRAINT {cmd.name} has no §3 spelling.",
                        "add/drop constraint is classified by the final §3 form. Dropping a check is not an admitted catalog spelling.",
                        ambiguity="ALTER … DROP CONSTRAINT IF EXISTS was not classified as DROP … IF EXISTS boilerplate. "
                        "The boilerplate row covers DROP statements; this ALTER changes a constraint. A later ADD may restore a different check.",
                    ),
                )
            )
        elif sub == "AT_ColumnDefault":
            kind_name = "alter_column_default"
            table = family.tables.get(stmt.relation.relname)
            col = table.cols.get(cmd.name) if table else None
            type_key = col.type_key if col else "unknown"
            if type_key in ("int2", "int4", "integer", "jsonb", "json", "uuid") or (col and col.array):
                res = refused(
                    f"ALTER COLUMN {cmd.name} SET DEFAULT leaves type {type_key}, which is not an admitted column.",
                    "The final catalog change is still that column type; the default rewrite cannot remove it.",
                )
            else:
                res = classify_default(cmd.def_, "timestamptz" if type_key == "timestamptz" else type_key)
            children.append(("column", res))
        elif sub == "AT_EnableRowSecurity":
            continue
        else:
            kind_name = "alter_other"
            extra = refused(
                f"ALTER TABLE {sub} has no §3 form.",
                "Remaining ALTER is refused when the final catalog change is not a §3 column, constraint, or RLS enablement.",
            )
    base = structural_base(if_not_exists, extra)
    if not children and extra is None and if_not_exists:
        children = []
    return finish_parent(file, index, kind_name, base, children)


def classify_routine(file, index, stmt, slice_sql, family):
    name = qname(stmt.funcname)
    bundle_name = name if name in BUNDLE else None
    sig = classify_signature(stmt, family, bundle_name)
    body = routine_body(stmt, family, slice_sql, bundle_name)
    if stmt.is_procedure and not bundle_name:
        body_worst = worst([res.cls for _k, res in body]) if body else "admitted"
        if body_worst == "refused" or any(_k == "plpgsql_commit" for _k, _r in body):
            sig = refused(
                "Procedure is a job only when every sweep and prelude fits §3.6.",
                "This body has refused statements or COMMIT, so it is not an admitted job. jsonb parameters, when present, also have no spelling.",
            )
        elif sig.cls == "admitted" and stmt.replace:
            sig = Res(
                "canonicalized",
                ambiguity="create or replace procedure is a creation alias, and the body fits the job grammar.",
            )
    children = [("signature", sig)] + body
    # Procedure/function top-level class is the worst of signature and body.
    base = ok_bool()
    kind_name = "procedure" if stmt.is_procedure else "function"
    return finish_parent(file, index, kind_name, base, children)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_hashes():
    freeze = json.loads((ROOT / "freeze.json").read_text())
    rubric_path = ROOT / "rubric-section7.md"
    rubric_hash = sha256_file(rubric_path)
    files = []
    all_ok = rubric_hash == freeze["rubric"]["sha256"]
    for item in freeze["manifest"]:
        path = CORPUS / item["path"]
        digest = sha256_file(path)
        text = path.read_text()
        lines = len(text.splitlines())
        ok = digest == item["sha256"] and lines == item["lines"]
        all_ok = all_ok and ok
        files.append(
            {
                "path": item["path"],
                "sha256": digest,
                "expected": item["sha256"],
                "matches": digest == item["sha256"],
                "lines": lines,
                "expectedLines": item["lines"],
                "linesMatch": lines == item["lines"],
            }
        )
    payload = {
        "verifiedAt": "2026-09-26",
        "freezeMatches": all_ok,
        "rfcCommit": freeze.get("rfcCommit"),
        "rubric": {
            "path": "rubric-section7.md",
            "sha256": rubric_hash,
            "expected": freeze["rubric"]["sha256"],
            "matches": rubric_hash == freeze["rubric"]["sha256"],
        },
        "files": files,
        "parser": {
            "package": "python3-pglast 6.2-1build1",
            "libpg_query": "libpg-query1605.1 16-5.1.0-2",
            "postgresqlVersion": list(get_postgresql_version()),
            "pglastVersion": "6.2",
            "note": "Postgres parser via pglast. Distro packages extracted under out/parser-deps because a network pip install was not used. This is libpg_query 16.1, not the Postgres 17 parser in the RFC verification paragraph. Every frozen statement parsed.",
            "placeholder": "Muse files contain the bytes {{P}}. They were parsed after replacing that placeholder with ns_. Hashes above are of the unsubstituted files.",
        },
    }
    (OUT / "verified-hashes.json").write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def tier_of(unit):
    kind = unit["kind"]
    if kind == "signature":
        return "signature"
    if kind in ("column", "constraint"):
        return "column_constraint"
    if kind == "sql_body" or kind.startswith("plpgsql_"):
        return "body"
    return "top"


def rate(numer, denom):
    if denom == 0:
        return "0/0"
    return f"{numer}/{denom} ({numer / denom:.4f})"


def exceeds_third(numer, denom):
    if denom == 0:
        return False
    return numer * 3 > denom


def summarize(units, hashes):
    files = FILES
    tiers = ["top", "body", "column_constraint", "signature"]
    classes = ["admitted", "canonicalized", "rewritten", "refused", "ignored"]

    def bucket(subset):
        rows = {t: {c: 0 for c in classes} | {"n": 0, "raw": 0, "post": 0} for t in tiers}
        for unit in subset:
            t = tier_of(unit)
            rows[t]["n"] += 1
            rows[t][unit["class"]] += 1
            if unit["raw_refused"]:
                rows[t]["raw"] += 1
            if unit["class"] == "refused":
                rows[t]["post"] += 1
        return rows

    by_file = {f: bucket([u for u in units if u["file"] == f]) for f in files}
    overall = bucket(units)

    def nonignored_post(rows, tier):
        n = rows[tier]["n"] - rows[tier]["ignored"]
        # Post-rewrite refusals that are not ignored are just refused.
        return rows[tier]["post"], n

    lines = []
    lines.append("# Pre-test 1 classification")
    lines.append("")
    lines.append("Instrument: rubric-section7.md (hash matches freeze.json) and rfc-4001.md §3.1–§3.7.")
    lines.append(
        f"Parser: pglast {hashes['parser']['pglastVersion']}, libpg_query PostgreSQL {'.'.join(map(str, hashes['parser']['postgresqlVersion']))}. "
        "Hashes of the rubric and the nine corpus files match freeze.json (see `verified-hashes.json`)."
    )
    lines.append(
        "Muse sources were parsed after replacing the placeholder `{{P}}` with `ns_`. "
        "That substitution is not a classification. Counts use the substituted AST, whose statement boundaries match the frozen text."
    )
    lines.append("")
    lines.append("## Denominators")
    lines.append("")
    lines.append("- **Top-level:** one Postgres AST statement per file. A table or alter-column statement's class is the worst non-ignored child, and also `canonicalized` when `if not exists` is the creation alias and no child is worse. `create or replace` is on the signature, so a routine's top-level class is the worst of signature and body.")
    lines.append("- **Body:** executable plpgsql statement nodes, plus one SQL-body statement per language-sql routine statement. Block and declaration wrappers are omitted. Parser-inserted returns with no source line are omitted. Anonymous `DO` bodies are included.")
    lines.append("- **Column and constraint children:** each column, and each primary key, unique, check, foreign key, or exclusion constraint. `NOT NULL` and `DEFAULT` stay on the column. These denominators are not added to the top-level rate.")
    lines.append("- **Signature:** one per routine. Reported separately from the top-level rate and the body rate. The routine's top-level class already includes the signature via worst-of.")
    lines.append("- **Raw refusal:** class is `rewritten` or `refused` (the authored spelling is not admitted, canonicalized, or ignored).")
    lines.append("- **Post-rewrite refusal:** class is `refused`.")
    lines.append("- Ignored boilerplate stays in the denominator. A second rate excluding ignored statements is listed because §7 says \"counted\" without saying whether boilerplate is in the one-third base.")
    lines.append("")
    lines.append("## Rates")
    lines.append("")
    header = "| file | tier | n | admitted | canonicalized | rewritten | refused | ignored | raw | post-rewrite |"
    sep = "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
    lines.append(header)
    lines.append(sep)

    def add_rows(label, rows):
        for tier in tiers:
            r = rows[tier]
            lines.append(
                f"| {label} | {tier} | {r['n']} | {r['admitted']} | {r['canonicalized']} | {r['rewritten']} | {r['refused']} | {r['ignored']} | {rate(r['raw'], r['n'])} | {rate(r['post'], r['n'])} |"
            )

    for f in files:
        add_rows(f"`{f}`", by_file[f])
    add_rows("**overall**", overall)
    lines.append("")
    lines.append("Post-rewrite rates excluding ignored units (numerator unchanged):")
    lines.append("")
    lines.append("| slice | tier | post-rewrite / non-ignored | exceeds one third |")
    lines.append("| --- | --- | --- | --- |")
    for label, rows in [(f, by_file[f]) for f in files] + [("overall", overall)]:
        for tier in ("top", "body"):
            numer, denom = nonignored_post(rows, tier)
            flag = "yes" if exceeds_third(numer, denom) else "no"
            lines.append(f"| {label} | {tier} | {rate(numer, denom)} | {flag} |")
    lines.append("")
    lines.append("## Named idiom instances")
    lines.append("")
    lines.append("### Muse `is_member`")
    lines.append("")
    lines.append("Registered rewrite: inline the full-key probe, including `left_at is null`.")
    lines.append("")
    lines.append("The helper body is:")
    lines.append("")
    lines.append("```sql")
    lines.append("select exists (select 1 from {{P}}members m")
    lines.append("  where m.conversation_id = c and m.user_id = u and m.left_at is null);")
    lines.append("```")
    lines.append("")
    lines.append(
        "`{{P}}members` primary key is `(conversation_id, user_id)`, so the two equalities cover one total unique key and `left_at is null` is a residual null test. "
        "§3.3 says this probe \"is admitted as a rule\" and that the residual blocks audience inversion (`E_SYNC` if the table is published). "
        "The frozen rubric also says the source corpus does not by itself require device replication, online-only is allowed, and `E_SYNC` alone is not a stop. "
        "No product brief in this frozen directory requires the membership rule to hold offline."
    )
    lines.append("")
    lines.append(
        "**Answer:** yes. After inlining, the policy spelling is an admitted full-key probe plus that residual. "
        "The helper's `u uuid` parameter is a separate unit: this family also contains `user_id::text` (feed) so the conditional UUID-to-`snapback.principal` rewrite is not applied to uuid columns and parameters. "
        "That type refusal does not remove the inlined rule spelling §3.3 names."
    )
    lines.append("")
    lines.append("### Muse `bump_counters` and Astra `clqfa_like_counter`")
    lines.append("")
    lines.append("Registered rewrite: generated `snapback.count` columns, with the same insert/delete behavior and visibility; filters use the registered maintain predicate. Drift or side effects the declaration cannot express refuse the bundle.")
    lines.append("")
    lines.append("Astra `clqfa_like_counter`:")
    lines.append("")
    lines.append("```sql")
    lines.append("if TG_OP='INSERT' then update clqfa_posts set like_count=like_count+1 where id=NEW.post; return NEW;")
    lines.append("else update clqfa_posts set like_count=like_count-1 where id=OLD.post; return OLD; end if;")
    lines.append("```")
    lines.append("")
    lines.append(
        "Trigger `clqfa_likes_counter` is `after insert or delete` on `clqfa_likes`. "
        "`clqfa_likes.post` references `clqfa_posts(id)`, one contributor, no filter, no `greatest` floor, no second write. "
        "Visibility is the `like_count` column on the post row."
    )
    lines.append("")
    lines.append(
        "**Astra answer:** yes. The bundle rewrites to `like_count bigint generated always as (snapback.count('clqfa_likes', by => 'post')) stored`. "
        "Ambiguity: an `UPDATE` of `clqfa_likes.post` would be maintained by `snapback.count` and is not maintained by this trigger. No such writer appears in the frozen Astra files."
    )
    lines.append("")
    lines.append("Muse `bump_counters` delete path:")
    lines.append("")
    lines.append("```sql")
    lines.append("else update {{P}}posts set like_count = greatest(like_count - 1, 0) where id = OLD.post_id; end if;")
    lines.append("```")
    lines.append("")
    lines.append("The same `greatest(… - 1, 0)` floor is used for `repost_count` and `reply_count`. Reply inserts are conditional on `parent_id is not null`.")
    lines.append("")
    lines.append(
        "**Muse answer:** no. The floor is a side effect `snapback.count` does not express. "
        "The three triggers (`{{P}}trg_like_c`, `{{P}}trg_repost_c`, `{{P}}trg_reply_c`) and the function stay refused after the registered rewrite."
    )
    lines.append("")
    lines.append("### Muse `enforce_message_windows`")
    lines.append("")
    lines.append("Registered rewrite: mutation-side `raise` checks with fixed intervals, and `edited` assignments in every writer, including privileged or job paths the trigger covered. An uncovered writer or a changed boundary refuses.")
    lines.append("")
    lines.append("```sql")
    lines.append("edit_s := coalesce(({{P}}cfg_windows()->>'editWindowSeconds')::int, 900);")
    lines.append("del_s := coalesce(({{P}}cfg_windows()->>'deleteForEveryoneWindowSeconds')::int, 3600);")
    lines.append("if (NEW.body is distinct from OLD.body) and not NEW.deleted and not OLD.deleted then")
    lines.append("  if extract(epoch from (now() - OLD.created_at)) > edit_s then")
    lines.append("    raise exception 'CLQFM_EDIT_WINDOW_EXCEEDED';")
    lines.append("  end if;")
    lines.append("  NEW.edited := true; NEW.edited_at := now();")
    lines.append("end if;")
    lines.append("```")
    lines.append("")
    lines.append("`cfg_windows()` defaults to `'{\"editWindowSeconds\":900,...\"deleteForEveryoneWindowSeconds\":3600,...}'` and otherwise reads `{{P}}config`. The trigger is `before update` on `{{P}}messages` and returns immediately when `NEW.purged`.")
    lines.append("")
    lines.append(
        "Writers in the frozen SQL: `expire_tick` sets `purged = true, body = '', media_path = ''` (the purge bypass), and policy `{{P}}msg_upd` allows the sender to `UPDATE` the row directly. There is no edit or delete mutation that could host the raise."
    )
    lines.append("")
    lines.append(
        "**Answer:** no. A fixed interval would change the boundary whenever `{{P}}config` differs from 900/3600, and a direct update under `msg_upd` would be an uncovered writer. `NEW.edited` / `NEW.edited_at` assignments would not run on that path."
    )
    lines.append("")
    lines.append("### Muse `feed`")
    lines.append("")
    lines.append("Registered rewrite: Following + page + shape, only if public-source admission, audience, duplicates, ranking, and continuation agree. CTE removal alone is not equivalence.")
    lines.append("")
    lines.append("```sql")
    lines.append("with scope as (")
    lines.append("  select f.followee_id as who from {{P}}follows f where f.follower_id = viewer")
    lines.append("  union select viewer")
    lines.append("),")
    lines.append("orig as ( … where p.parent_id is null and (tab = 'global' or p.author_id in (select who from scope)) ),")
    lines.append("repo as ( … where p.parent_id is null and (tab = 'global' or r.user_id in (select who from scope)) ),")
    lines.append("stream as (select * from orig union all select * from repo)")
    lines.append("… where (before_ts is null or s.sort_ts < before_ts or (s.sort_ts = before_ts and s.sort_key < before_id))")
    lines.append("order by s.sort_ts desc, s.sort_key desc")
    lines.append("limit lim")
    lines.append("```")
    lines.append("")
    lines.append("The comment in `rpcs.sql` says an original and each qualifying repost \"surface as SEPARATE cards\". `union all` matches that duplicate behavior. Ranking is repost time for reposts and post time for originals.")
    lines.append("")
    lines.append(
        "Following admission in §3.4 requires published public sources, owner-only writes, immutable mapped columns, and the declared edge key. "
        "The frozen Muse SQL has `using (true)` select policies on posts, follows, and reposts, but no `snapback.publish` call. "
        "There is no `snapback.immutable` call, and `{{P}}post_upd` is `using (auth.uid() = author_id) with check (auth.uid() = author_id)`, so the author can update mapped columns. "
        "`feed(viewer uuid, tab text, …)` takes a caller-supplied viewer; §3.7 refuses that parameter with an `auth.uid()` rewrite, which changes results whenever `viewer` is not the session principal. "
        "`tab = 'global'` reads every public post, which is not the Following audience. "
        "Continuation is a keyset predicate; §3.5 refuses a keyset predicate on a cursor."
    )
    lines.append("")
    lines.append(
        "**Answer:** no. Duplicates can be described by `union all`, but publication, immutability, the global tab, the viewer parameter, and keyset continuation do not agree with Following + page + shape."
    )
    lines.append("")
    lines.append("## Stop-rule evaluation")
    lines.append("")
    top_n = overall["top"]["n"]
    top_post = overall["top"]["post"]
    body_n = overall["body"]["n"]
    body_post = overall["body"]["post"]
    top_ex = exceeds_third(top_post, top_n)
    body_ex = exceeds_third(body_post, body_n)
    top_ni, top_ni_n = nonignored_post(overall, "top")
    body_ni, body_ni_n = nonignored_post(overall, "body")
    lines.append(
        f"Post-rewrite top-level refusals: {top_post}/{top_n} = {top_post / top_n:.4f}. "
        f"One third of {top_n} is {top_n / 3:.4f}. Exceeds one third: **{'yes' if top_ex else 'no'}** "
        f"(`refused * 3 > n` is {top_post * 3} > {top_n})."
    )
    lines.append(
        f"Post-rewrite body refusals: {body_post}/{body_n} = {body_post / body_n:.4f}. "
        f"One third of {body_n} is {body_n / 3:.4f}. Exceeds one third: **{'yes' if body_ex else 'no'}** "
        f"(`refused * 3 > n` is {body_post * 3} > {body_n})."
    )
    lines.append(
        f"Excluding ignored units, top-level is {rate(top_ni, top_ni_n)} (exceeds: {'yes' if exceeds_third(top_ni, top_ni_n) else 'no'}) "
        f"and body is {rate(body_ni, body_ni_n)} (exceeds: {'yes' if exceeds_third(body_ni, body_ni_n) else 'no'})."
    )
    lines.append(
        "Named instances without a behavior-preserving admitted spelling after the registered rewrite: "
        "Muse `bump_counters`; Muse `enforce_message_windows`; Muse `feed`. "
        "Muse `is_member` and Astra `clqfa_like_counter` have one."
    )
    lines.append(
        "The one-third comparisons and the three negative instance answers are the stop-rule predicates in §7. "
        "Raw-refusal rates are the other census and are not the stop line."
    )
    lines.append("")
    lines.append("## Ambiguities")
    lines.append("")
    groups = {}
    for unit in units:
        if not unit["ambiguity"]:
            continue
        groups.setdefault(unit["ambiguity"], []).append(unit["id"])
    lines.append(f"{len(groups)} distinct ambiguity texts on {sum(len(v) for v in groups)} units.")
    lines.append("")
    for text, ids in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        sample = ", ".join(f"`{i}`" for i in ids[:8])
        more = "" if len(ids) <= 8 else f", … ({len(ids)} units)"
        lines.append(f"- ({len(ids)}) {text} Examples: {sample}{more}.")
    lines.append("")
    lines.append("## Parser and counting choices")
    lines.append("")
    lines.append("- `NOT NULL` and `DEFAULT` are column attributes, not extra constraint units. Primary key, unique, check, and foreign key are constraint units, including column-level ones.")
    lines.append("- Language-sql bodies are one body unit per parsed SQL statement. §7 names plpgsql statement nodes; dropping these bodies would omit `is_member` and `feed` from the body denominator.")
    lines.append("- `DO` bodies are in the body denominator. The `DO` statement itself is one refused top-level unit.")
    lines.append("- Integer columns are refused because §3.1's spelling is `bigint`, except Astra `like_count`, which the successful count rewrite replaces.")
    lines.append("- `to authenticated` is ignored inside the policy and is not its own unit (§3.3). `GRANT`/`REVOKE` and `SET search_path` are ignored units (§3.7 C).")
    lines.append("- No `snapback.immutable` call appears. `using (E) with check (E)` was not canonicalized to the single-image update alias.")
    (OUT / "summary.md").write_text("\n".join(lines) + "\n")
    return overall


def validate(units):
    required = ["id", "file", "kind", "class", "rewrite", "nodes", "explanation", "raw_refused", "post_rewrite_refused", "ambiguity"]
    ids = set()
    for unit in units:
        for key in required:
            if key not in unit:
                raise SystemExit(f"missing {key} on {unit}")
        if unit["class"] not in RANK:
            raise SystemExit(f"bad class {unit}")
        if unit["id"] in ids:
            raise SystemExit(f"duplicate id {unit['id']}")
        ids.add(unit["id"])
        if unit["class"] == "rewritten":
            if not unit["rewrite"] or not unit["nodes"] or not unit["explanation"] or not unit["raw_refused"]:
                raise SystemExit(f"rewritten fields incomplete: {unit['id']}")
            if unit["post_rewrite_refused"]:
                raise SystemExit(f"rewritten has post refusal: {unit['id']}")
        elif unit["class"] == "refused":
            if not unit["raw_refused"] or not unit["post_rewrite_refused"]:
                raise SystemExit(f"refused fields incomplete: {unit['id']}")
            if unit["rewrite"]:
                raise SystemExit(f"refused has rewrite: {unit['id']}")
        else:
            if unit["raw_refused"] or unit["post_rewrite_refused"] or unit["rewrite"]:
                raise SystemExit(f"non-refusal has refusal fields: {unit['id']} {unit['class']}")
    # Helpers registered?
    return ids


def main():
    hashes = write_hashes()
    if not hashes["freezeMatches"]:
        raise SystemExit("freeze.json hashes did not match")
    loaded = load_sources()
    families = build_families(loaded)
    for name, family in families.items():
        print(f"{name}: tables={len(family.tables)} helpers={sorted(family.helpers)} uuid_ops={family.uuid_ops} evidence={family.uuid_op_evidence}")
    if "ns_is_member" not in families["muse-supabase"].helpers:
        raise SystemExit("is_member was not recognized as a probe helper")
    if "ns_ever_member" not in families["muse-supabase"].helpers or "ns_is_admin" not in families["muse-supabase"].helpers:
        raise SystemExit("ever_member/is_admin probe registration failed")
    if "ns_created_by" in families["muse-supabase"].helpers:
        raise SystemExit("created_by was incorrectly registered as a probe")
    units = classify_loaded(loaded, families)
    validate(units)
    with (OUT / "units.jsonl").open("w") as fh:
        for unit in units:
            fh.write(json.dumps(unit, ensure_ascii=False) + "\n")
    overall = summarize(units, hashes)
    print("units", len(units))
    for tier in ("top", "body", "column_constraint", "signature"):
        r = overall[tier]
        print(tier, r)


if __name__ == "__main__":
    main()
