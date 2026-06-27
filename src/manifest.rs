use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct SchemaManifest {
    pub schema_hash: Option<String>,
    pub tables: Vec<TableManifest>,
}

impl SchemaManifest {
    pub fn table(&self, name: &str) -> Option<&TableManifest> {
        self.tables.iter().find(|table| table.name == name)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TableManifest {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldManifest>,
    #[serde(default)]
    pub indexes: Vec<IndexManifest>,
    #[serde(default)]
    pub syncable: bool,
}

impl TableManifest {
    pub fn field(&self, name: &str) -> Option<&FieldManifest> {
        self.fields.iter().find(|field| field.name == name)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FieldManifest {
    pub name: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum FieldType {
    String,
    Boolean,
    Integer,
    Real,
    Json,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IndexManifest {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FunctionManifest {
    pub bundle_hash: Option<String>,
    #[serde(default)]
    pub functions: Vec<FunctionDefinition>,
}

impl FunctionManifest {
    pub fn function(&self, name: &str) -> Option<&FunctionDefinition> {
        self.functions.iter().find(|function| function.name == name)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FunctionDefinition {
    pub name: String,
    pub kind: FunctionKind,
    pub runtime: FunctionRuntime,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum FunctionKind {
    Query,
    Mutation,
    LiveQuery,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum FunctionRuntime {
    HostPlan(HandlerPlan),
    IbexModule(IbexModule),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IbexModule {
    pub source: String,
    pub export: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum HandlerPlan {
    Query(QueryPlan),
    Mutation(MutationPlan),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct QueryPlan {
    pub table: String,
    #[serde(default)]
    pub filters: Vec<FilterExpr>,
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    pub limit: Option<usize>,
    pub indexed_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FilterExpr {
    pub field: String,
    pub op: FilterOp,
    pub value: ValueExpr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum FilterOp {
    Eq,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OrderExpr {
    pub field: String,
    pub direction: OrderDirection,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationPlan {
    #[serde(default)]
    pub steps: Vec<MutationStep>,
    pub return_value: Option<ReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum MutationStep {
    Insert {
        table: String,
        values: BTreeMap<String, ValueExpr>,
        bind_id_as: Option<String>,
    },
    Patch {
        table: String,
        id: ValueExpr,
        values: BTreeMap<String, ValueExpr>,
    },
    Delete {
        table: String,
        id: ValueExpr,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum ReturnValue {
    Literal(Value),
    Binding(String),
    Document { table: String, id: ValueExpr },
    ChangedCount,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum ValueExpr {
    Arg(String),
    AuthUserId,
    Binding(String),
    Literal(Value),
    RuntimeId,
    RuntimeNow,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AuthInput {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct HandlerInput {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReadDependency {
    pub table: String,
    pub id: String,
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct QueryOutput {
    pub version: u64,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationOutput {
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SeedData {
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}
