# SEC7 integration survey review obligations

450 projects; 15 authored schemas require review. The following are concrete retained-role discrepancies, not a claim that the independent application specification requires revocation. Every obligation was individually acknowledged on a disposable copy; each final check exits zero. Those experimental decisions do not change the originals or certify their policies.

## w16-013-snapback-hackathon-rubric-judging

Source SHA256: `692feb074a251ae09260f4683d3cfc1193efc59783d4910d167d72c5ac6fe44b`. Authored check exits 1; acknowledged-copy check exits 0.

- submissions.read: retained assignments grants are written by assignJudge requiring recipient `exists roles[viewer, role = 'judge']`, but read branch `exists assignments[.id, viewer]` does not recheck that mutable current role

## w16-019-snapback-apiary-hive-inspections

Source SHA256: `e10cce3d6952bdaa55d836a2e0cd517483a9db1401a183506fcdc87e44351147`. Authored check exits 1; acknowledged-copy check exits 0.

- hives.read: retained routes grants are written by assignRoute requiring recipient `exists roles[viewer, role = 'inspector']`, but read branch `exists routes[viewer, .route]` does not recheck that mutable current role
- inspections.read: retained routes grants are written by assignRoute requiring recipient `exists roles[viewer, role = 'inspector']`, but read branch `exists routes[viewer, .$hive.route]` does not recheck that mutable current role

## w16-027-snapback-podcast-guest-releases

Source SHA256: `0a79216d64202e4d97fc4a66ec6cf98c0629d0afdba950ba45b6659f436bf6a2`. Authored check exits 1; acknowledged-copy check exits 0.

- episodes.read: retained bookings grants are written by bookGuest requiring recipient `exists roles[viewer, role = 'guest']`, but read branch `exists bookings[.id, viewer]` does not recheck that mutable current role

## w18-019-snapback-chimney-sweep-reports

Source SHA256: `b3cbd75c247ff21966ccda147e688c481e992ec870830c47dbaf6e0d11552619`. Authored check exits 1; acknowledged-copy check exits 0.

- amendments.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role
- chimneys.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.id, viewer]` does not recheck that mutable current role
- rentalUnits.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role
- reports.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role

## w18-030-snapback-cat-show-ring-judging

Source SHA256: `da54dafba001d19902c25cf17c73b4f4318fce0bda3f800b5cc8579d3460d055`. Authored check exits 1; acknowledged-copy check exits 0.

- catalog.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'judge']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- decisions.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'judge']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- catalog.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'clerk']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- decisions.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'clerk']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role

## w19-019-snapback-chimney-sweep-reports

Source SHA256: `b4544e7cd058cc3c42b8d8e453db05d9cbdc7d3ee109597a2506de77b5726cf2`. Authored check exits 1; acknowledged-copy check exits 0.

- amendments.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role
- chimneys.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.id, viewer]` does not recheck that mutable current role
- rentalUnits.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role
- reports.read: retained assignments grants are written by assignJob requiring recipient `exists roles[viewer, role = 'sweep']`, but read branch `exists assignments[.chimney, viewer]` does not recheck that mutable current role

## w19-030-snapback-cat-show-ring-judging

Source SHA256: `6bf2eea48f40dc5e505e9caf15bf1a6e00667c228b7553828455c401ff6eb06f`. Authored check exits 1; acknowledged-copy check exits 0.

- catalog.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'judge']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- decisions.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'judge']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- catalog.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'clerk']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role
- decisions.read: retained showStaff grants are written by createRing requiring recipient `exists roles[viewer, role = 'clerk']`, but read branch `exists showStaff[.show, viewer]` does not recheck that mutable current role

## w20-013-snapback-piano-competition-juries

Source SHA256: `e5f6d70074e0806aca257f7b01674f8a7816523bdbee87a19cacc78e5222403e`. Authored check exits 1; acknowledged-copy check exits 0.

- decisions.read: retained grants grants are written by submitEntry requiring recipient `exists roles[viewer, role = 'teacher']`, but read branch `exists grants[.entry, viewer]` does not recheck that mutable current role
- entries.read: retained grants grants are written by submitEntry requiring recipient `exists roles[viewer, role = 'teacher']`, but read branch `exists grants[.id, viewer]` does not recheck that mutable current role
- decisions.read: retained grants grants are written by assign requiring recipient `exists roles[viewer, role = 'juror']`, but read branch `exists grants[.entry, viewer]` does not recheck that mutable current role
- entries.read: retained grants grants are written by assign requiring recipient `exists roles[viewer, role = 'juror']`, but read branch `exists grants[.id, viewer]` does not recheck that mutable current role

## w20-015-snapback-sailmaker-repair-orders

Source SHA256: `6cf86bd00bf774b978416ef075307c021b0bfd4c107195e0d675a74d4392c4fa`. Authored check exits 1; acknowledged-copy check exits 0.

- boats.read: retained assignments grants are written by assignRigger requiring recipient `exists roles[viewer, role = 'rigger']`, but read branch `exists assignments[.id, viewer]` does not recheck that mutable current role

## w20-048-snapback-therapeutic-riding-sessions

Source SHA256: `e3cc8762564856d51e664f57a85bdbc5264d64101b146f1b52b64527d33f913d`. Authored check exits 1; acknowledged-copy check exits 0.

- progressNotes.read: retained familyLinks grants are written by addRider requiring recipient `exists roles[viewer, role = 'family']`, but read branch `exists familyLinks[.rider, viewer]` does not recheck that mutable current role
- riders.read: retained familyLinks grants are written by addRider requiring recipient `exists roles[viewer, role = 'family']`, but read branch `exists familyLinks[.id, viewer]` does not recheck that mutable current role

## w21-013-snapback-piano-competition-juries

Source SHA256: `11c8ffb735dd92c1cc54c61d1c75c7de8d785bb77a4ae6427699f45aecfb1672`. Authored check exits 1; acknowledged-copy check exits 0.

- decisions.read: retained grants grants are written by submitEntry requiring recipient `exists roles[viewer, role = 'teacher']`, but read branch `exists grants[.entry, viewer]` does not recheck that mutable current role
- entries.read: retained grants grants are written by submitEntry requiring recipient `exists roles[viewer, role = 'teacher']`, but read branch `exists grants[.id, viewer]` does not recheck that mutable current role
- decisions.read: retained grants grants are written by assign requiring recipient `exists roles[viewer, role = 'juror']`, but read branch `exists grants[.entry, viewer]` does not recheck that mutable current role
- entries.read: retained grants grants are written by assign requiring recipient `exists roles[viewer, role = 'juror']`, but read branch `exists grants[.id, viewer]` does not recheck that mutable current role

## w21-015-snapback-sailmaker-repair-orders

Source SHA256: `8690182b26913b75f8b6ecf962c699a26b67adcd7df24d28bb2f1b55aacbac61`. Authored check exits 1; acknowledged-copy check exits 0.

- boats.read: retained assignments grants are written by assignRigger requiring recipient `exists roles[viewer, role = 'rigger']`, but read branch `exists assignments[.id, viewer]` does not recheck that mutable current role

## w21-048-snapback-therapeutic-riding-sessions

Source SHA256: `7c6b5cf42152be4487c06fa738bd327a3d95e506ef3e8731a8d9cd55af310d1d`. Authored check exits 1; acknowledged-copy check exits 0.

- progressNotes.read: retained familyLinks grants are written by addRider requiring recipient `exists roles[viewer, role = 'family']`, but read branch `exists familyLinks[.rider, viewer]` does not recheck that mutable current role
- riders.read: retained familyLinks grants are written by addRider requiring recipient `exists roles[viewer, role = 'family']`, but read branch `exists familyLinks[.id, viewer]` does not recheck that mutable current role

## w22-021-snapback-wash-fold-laundry

Source SHA256: `92db3d88ca7020bbf3aeeb7a2df0947b06be076145e5b68a95649bc325ccad5e`. Authored check exits 1; acknowledged-copy check exits 0.

- orders.read: retained driverRoutes grants are written by assignRoute requiring recipient `exists roles[viewer, role = 'driver']`, but read branch `exists driverRoutes[viewer, route = .route]` does not recheck that mutable current role

## w23-021-snapback-wash-fold-laundry

Source SHA256: `977b641b9ea99b8f48e3a7f62d212a4b559b296af6f46d7532b47f7549c90cfb`. Authored check exits 1; acknowledged-copy check exits 0.

- orders.read: retained driverRoutes grants are written by assignRoute requiring recipient `exists roles[viewer, role = 'driver']`, but read branch `exists driverRoutes[viewer, route = .route]` does not recheck that mutable current role
