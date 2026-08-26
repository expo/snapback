pub fn production() -> &'static str {
    "production"
}

#[cfg(test)]
mod tests;

#[cfg(test)] #[path = "external-test-modules/path_tests.rs"] mod path_tests;
