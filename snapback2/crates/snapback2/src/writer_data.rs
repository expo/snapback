use super::*;

impl State {
    pub(super) fn data(
        &mut self,
        table_name: String,
        index_name: String,
        prefix: Json,
        after: Option<Json>,
        limit: u32,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        if limit == 0 || limit > 500 {
            return Err(Refusal::input(
                "data limit must be between 1 and 500",
                "pass --limit 1..500",
            ));
        }
        let table = self
            .runtime()
            .generation()
            .schema()
            .tables
            .get(&table_name)
            .cloned()
            .ok_or_else(|| {
                Refusal::new(
                    "E_SCHEMA_TABLE_UNKNOWN",
                    "schema",
                    format!("unknown table {table_name}"),
                    "use a table listed by /api/manifest",
                    "schema/tables",
                )
            })?;
        let certified_limit = max_certified_page_rows(
            self.runtime().generation().schema(),
            &table_name,
            &Ceilings::default(),
        )
        .min(500);
        if certified_limit == 0 {
            return Err(Refusal::new(
                "E_BOUND",
                "bound",
                format!("declared rows from {table_name} exceed the data output ceiling"),
                "lower the table's declared serialized row maximum",
                "bound/output",
            ));
        }
        let limit = limit.min(certified_limit);
        let index = table.indexes.get(&index_name).ok_or_else(|| {
            Refusal::new(
                "E_SCHEMA_INDEX_UNKNOWN",
                "schema",
                format!("unknown index {table_name}.{index_name}"),
                "use an index declared by the table",
                "schema/indexes",
            )
        })?;
        let prefix_values = prefix.as_array().ok_or_else(|| {
            Refusal::input("data prefix must be a JSON array", "pass --prefix '[...]'")
        })?;
        if prefix_values.len() > index.columns.len() {
            return Err(Refusal::input(
                "data prefix is longer than the index key",
                "remove extra prefix values",
            ));
        }
        let mut converted = Vec::new();
        for (position, value) in prefix_values.iter().enumerate() {
            let column = table
                .columns
                .get(&index.columns[position])
                .expect("certified index column");
            converted.push(json_as_kind(value, column)?);
        }
        if index.columns.last().map(String::as_str) != Some("id") && !index.unique {
            return Err(Refusal::input(
                format!("data index {table_name}.{index_name} does not end in intrinsic id"),
                "choose a total-order index that is unique or ends in id",
            ));
        }
        let pageable = prefix_values.len() < index.columns.len();
        let cursor_value = match after {
            Some(Json::String(token)) => Value::String(token),
            Some(_) => {
                return Err(Refusal::input(
                    "data after must be an opaque cursor token",
                    "pass --after <token>",
                ));
            }
            None => Value::Null,
        };
        let site = format!("<owner:data:{table_name}.{index_name}>");
        let mut args = BTreeMap::new();
        if pageable {
            args.insert("c".to_owned(), ArgType::Optional(Box::new(ArgType::Cursor)));
        } else if !matches!(cursor_value, Value::Null) {
            return Err(Refusal::input(
                "data after requires an index column after the prefix",
                "shorten the prefix or omit --after",
            ));
        }
        let program = Program {
            name: format!("__owner.data.{table_name}"),
            kind: ProgramKind::Query,
            args,
            read_time_granularity_ms: None,
            result_page_site: pageable.then(|| site.clone()),
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site,
                table: table_name,
                index: index_name,
                prefix: converted.into_iter().map(Expr::Literal).collect(),
                order: Order::Asc,
                take: Bound::Literal(limit),
                after: pageable.then(|| Box::new(Expr::Variable("c".to_owned()))),
                before: None,
                range: None,
                opaque_cursor: pageable,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let args = if pageable {
            BTreeMap::from([("c".to_owned(), cursor_value)])
        } else {
            BTreeMap::new()
        };
        let system = matches!(identity, Identity::Operator { .. });
        let execution = if let Identity::Operator { by } = identity {
            self.require_operator(&by)?;
            let now = self.now();
            let execution = self
                .runtime_mut()
                .read_operator(&program, args, snapback2_core::OperatorId(by.clone()), now)
                .map_err(|error| Refusal::from_runtime(&error))?;
            self.log_operator_read(&program.name, &by);
            execution
        } else {
            let authority = self.resolve_authority(identity)?;
            let context = self.execution_context(&authority, args)?;
            self.runtime_mut()
                .execute_adhoc(&program, context)
                .map_err(|error| Refusal::from_runtime(&error))?
        };
        let mut response = if system {
            writer_operator::operator_json(&execution)
        } else {
            execution_json(&execution)
        };
        if let Some(object) = response.as_object_mut() {
            object.insert("trace".to_owned(), json!(execution.trace));
        }
        Ok(response)
    }
}
