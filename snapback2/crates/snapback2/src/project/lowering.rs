use super::*;
impl CompilerWorker {
    pub(crate) fn lower_source(&mut self, root: &Path, source: Option<&str>) -> Result<(ProjectJson, CompileSuccess), Vec<Refusal>> {
        let response = self.request_body("compile", root, source)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let success: CompileSuccess = success_response(response, "compile")?;
        debug_assert!(success.ok);
        debug_assert_eq!(success.id, self.next_id);
        validate_quarry_outputs(&success.quarry).map_err(|error| vec![error])?;
        let mut project_value = success.project.clone();
        normalize_project_json(&mut project_value);
        let project: ProjectJson = serde_json::from_value(project_value).map_err(|error| {
            vec![Refusal::new(
                "E_OWNER_COMPILER_PROTOCOL",
                "owner",
                format!("compiler project does not match the landed engine API: {error}"),
                "rebuild the bundled compiler against this snapback2-core",
                "owner/compiler",
            )]
        })?;
        Ok((project, success))
    }
}
