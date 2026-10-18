use super::*;

#[test]
fn dev_catalog_contains_only_public_field_types() {
    let source = "use personas alice\ntable marks:\n  principal: principal\n  privateMark: int default 0 written by .principal\n  sharedMark: int default 0 written by .principal readable by audience\n  public 'marks'\n  sync public last 10 by .id\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    let catalog = body(&host.request("GET", "/dev/catalog", "", ""));
    assert!(catalog.as_object().unwrap().keys().all(|key| ["tables", "generation"].contains(&key.as_str())), "{catalog}");
    let tables = catalog["tables"].as_array().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].as_object().unwrap().len(), 2);
    assert_eq!(tables[0]["name"], "marks");
    assert_eq!(tables[0]["fields"], json!({"id":"Id", "principal":"Principal", "sharedMark":"Int"}));
}
