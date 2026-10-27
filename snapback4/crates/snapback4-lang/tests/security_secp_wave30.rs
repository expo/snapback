//! Regression subjects from the independent, per-note wave-30 source review.
use snapback4_lang::{compile,security};
#[test]fn wave30_each_manually_answered_question_is_quiet(){
  let cases:&[(&str,&[(&str,&str)],&[(&str,u32,&str)])]=&[
    ("003",&[("schema.q",include_str!("security/wave30/003.schema.q"))],&[("N_SWEEP_DEADLINE",100,"mutation recordPickup")]),
    ("004",&[("schema.q",include_str!("security/wave30/004.schema.q"))],&[("N_LOOKUP_FILTERED",128,"mutation advanceRoom"),("N_LOOKUP_FILTERED",155,"mutation cancelDeposit")]),
    ("008",&[("schema.q",include_str!("security/wave30/008.schema.q"))],&[("N_LOOKUP_FILTERED",151,"mutation finishCure")]),
    ("010",&[("schema.q",include_str!("security/wave30/010.schema.q"))],&[("N_LOOKUP_FILTERED",128,"mutation advanceTrip"),("N_LOOKUP_FILTERED",154,"mutation cancelHighWater")]),
    ("011",&[("schema.q",include_str!("security/wave30/011.schema.q"))],&[("N_SWEEP_DEADLINE",84,"mutation approveBedroom")]),
    ("012",&[("schema.q",include_str!("security/wave30/012.schema.q"))],&[("N_LOOKUP_FILTERED",145,"mutation approveReanimation")]),
    ("013",&[("schema.q",include_str!("security/wave30/013.schema.q"))],&[("N_LOOKUP_FILTERED",96,"mutation receive"),("N_LOOKUP_FILTERED",103,"mutation examine"),("N_LOOKUP_FILTERED",105,"mutation examine"),("N_LOOKUP_FILTERED",111,"mutation loadTest"),("N_LOOKUP_FILTERED",124,"mutation tag"),("N_LOOKUP_FILTERED",126,"mutation tag")]),
    ("017",&[("invariants.q",include_str!("security/wave30/017.invariants.q")),("schema.q",include_str!("security/wave30/017.schema.q"))],&[("N_EDIT_AFTER_APPROVAL",115,"cancelParty")]),
    ("018",&[("schema.q",include_str!("security/wave30/018.schema.q"))],&[("N_ARGUMENT_GRANT",81,"openVisit"),("N_LOOKUP_FILTERED",52,"mutation setQuarantine"),("N_LOOKUP_FILTERED",96,"mutation markVisit"),("N_LOOKUP_FILTERED",104,"mutation pruneVisit"),("N_LOOKUP_FILTERED",106,"mutation pruneVisit"),("N_LOOKUP_FILTERED",115,"mutation chipVisit"),("N_LOOKUP_FILTERED",164,"mutation recordMissed"),("N_LOOKUP_FILTERED",171,"mutation pruneTouchup"),("N_LOOKUP_FILTERED",173,"mutation pruneTouchup")]),
    ("020",&[("schema.q",include_str!("security/wave30/020.schema.q"))],&[("N_ARGUMENT_GRANT",117,"bookRide"),("N_ARGUMENT_GRANT",118,"bookRide"),("N_LOOKUP_FILTERED",138,"mutation cancelRide")]),
    ("022",&[("schema.q",include_str!("security/wave30/022.schema.q"))],&[("N_ARGUMENT_GRANT",82,"openFitting"),("N_LOOKUP_FILTERED",79,"mutation openFitting")]),
    ("024",&[("schema.q",include_str!("security/wave30/024.schema.q"))],&[("N_DEPENDENT_WINDOW",116,"scheduleService"),("N_DEPENDENT_WINDOW",126,"rescheduleVisit"),("N_LOOKUP_FILTERED",86,"mutation advanceInstall")]),
    ("025",&[("schema.q",include_str!("security/wave30/025.schema.q"))],&[("N_ARGUMENT_GRANT",152,"approveRetest")]),
    ("027",&[("schema.q",include_str!("security/wave30/027.schema.q"))],&[("N_LOOKUP_FILTERED",143,"mutation updateMuseum"),("N_LOOKUP_FILTERED",152,"mutation openBuild"),("N_LOOKUP_FILTERED",190,"mutation updatePrice")]),
    ("029",&[("schema.q",include_str!("security/wave30/029.schema.q"))],&[("N_LOOKUP_FILTERED",94,"mutation loadShipment"),("N_LOOKUP_FILTERED",101,"mutation deliverShipment"),("N_LOOKUP_FILTERED",107,"mutation delayWeather")]),
    ("031",&[("schema.q",include_str!("security/wave30/031.schema.q"))],&[("N_LOOKUP_FILTERED",182,"mutation createTower"),("N_LOOKUP_FILTERED",217,"mutation advanceStop")]),
    ("032",&[("schema.q",include_str!("security/wave30/032.schema.q"))],&[("N_DEPENDENT_WINDOW",138,"scheduleVisit"),("N_DEPENDENT_WINDOW",138,"scheduleVisit")]),
    ("033",&[("schema.q",include_str!("security/wave30/033.schema.q"))],&[("N_EDIT_AFTER_APPROVAL",102,"markDamp"),("N_QUERY_FILTERED",131,"query jobPhotos"),("N_QUERY_FILTERED",156,"query jobInvoices"),("N_QUERY_FILTERED",172,"query jobReports")]),
    ("035",&[("schema.q",include_str!("security/wave30/035.schema.q"))],&[("N_SWEEP_DEADLINE",84,"mutation approveQuote")]),
    ("036",&[("schema.q",include_str!("security/wave30/036.schema.q"))],&[("N_SWEEP_DEADLINE",141,"mutation requestChange"),("N_SWEEP_DEADLINE",148,"mutation approveChange")]),
    ("038",&[("schema.q",include_str!("security/wave30/038.schema.q"))],&[("N_LOOKUP_FILTERED",121,"mutation logDelivery")]),
    ("039",&[("schema.q",include_str!("security/wave30/039.schema.q"))],&[("N_QUERY_FILTERED",140,"query careHistory"),("N_QUERY_FILTERED",160,"query chickPhotos")]),
    ("041",&[("schema.q",include_str!("security/wave30/041.schema.q"))],&[("N_SWEEP_DEADLINE",79,"mutation setStage")]),
    ("042",&[("schema.q",include_str!("security/wave30/042.schema.q"))],&[("N_SWEEP_DEADLINE",110,"mutation returnItem")]),
    ("043",&[("schema.q",include_str!("security/wave30/043.schema.q"))],&[("N_EDIT_AFTER_APPROVAL",132,"approveAmendment"),("N_LOOKUP_FILTERED",129,"mutation approveAmendment")]),
    ("045",&[("schema.q",include_str!("security/wave30/045.schema.q"))],&[("N_QUERY_FILTERED",132,"query claimsFor")]),
    ("046",&[("schema.q",include_str!("security/wave30/046.schema.q"))],&[("N_LOOKUP_FILTERED",99,"mutation openJob")]),
    ("048",&[("schema.q",include_str!("security/wave30/048.schema.q"))],&[("N_SWEEP_DEADLINE",92,"mutation advanceBuild")]),
  ];
  let mut failures=Vec::new();
  for (lane,texts,subjects) in cases{
    let sources=texts.iter().map(|(file,text)|(file.to_string(),text.to_string())).collect::<Vec<_>>();
    let bound=compile(&sources);assert!(bound.diagnostics.is_empty(),"lane {lane}: {:?}",bound.diagnostics);
    let mut report=security::analyze_rules(&bound);security::add_source_notes(&mut report,&sources,&bound);
    let notes=bound.notes.into_iter().chain(report.notes).collect::<Vec<_>>();
    for (code,line,op) in *subjects{for n in &notes{if n.code==*code&&n.site.line==*line&&n.message.starts_with(op){failures.push(format!("lane {lane}: {}:{} {} {}",n.site.file,n.site.line,n.code,n.message));}}}
  }
  assert!(failures.is_empty(),"{}",failures.join("\n"));
}
