//! Startup presentation only: URL and readiness protocol retain their identity.
// @ref LLP 3000.037.000#9-repeat-command-output-budgets-tok2 — startup details do not alter server lifetime.
pub(crate) struct Startup { release: bool, lines: Vec<String>, ready: bool }
impl Startup {
    pub(crate) fn new(release: bool) -> Self { Self { release, lines: Vec::new(), ready: false } }
    pub(crate) fn line(&mut self, text: String) {
        if self.release { self.lines.push(text); } else { snapback4_core::diagnostic!("{text}"); }
    }
    pub(crate) fn ready(&mut self, identity: &str) {
        if !self.release { snapback4_core::diagnostic!("{identity}"); return; }
        self.ready = true;
        let text = format!("{identity}\n{}\n",self.lines.join("\n"));
        let path = crate::command_output::retain("serve",&text);
        let verbose = std::env::args().any(|s|matches!(s.as_str(),"--verbose"|"--explain"));
        snapback4_core::diagnostic!("{identity}");
        match path {
            Ok(path) if !verbose => {
                let decisions = self.lines.iter().filter(|l|l.starts_with("WARNING") || l.starts_with("clock ")).map(|l|l.split_whitespace().collect::<Vec<_>>().join(" ")).collect::<Vec<_>>();
                snapback4_core::diagnostic!("serve: tokens only; {}details: {}; --explain for startup facts",if decisions.is_empty() {String::new()}else{format!("{}; ",decisions.join("; "))},crate::command_output::display_path(&path));
            }
            result => {
                for line in &self.lines { snapback4_core::diagnostic!("{line}"); }
                if let Err(error) = result {snapback4_core::diagnostic!("serve: details unavailable: {error}; full startup shown");}
            }
        }
    }
}
impl Drop for Startup {
    fn drop(&mut self) {
        // Failure before readiness cannot swallow warnings collected so far.
        if self.release && !self.ready && !self.lines.is_empty() {
            let text=self.lines.join("\n");
            match crate::command_output::retain("serve",&text) {
                Ok(path)=>snapback4_core::diagnostic!("{}; details: {}",text.split_whitespace().collect::<Vec<_>>().join(" "),crate::command_output::display_path(&path)),
                Err(_)=>for line in &self.lines {snapback4_core::diagnostic!("{line}");},
            }
        }
    }
}
