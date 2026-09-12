table profiles:
  scope: text <=20
  avatarUrl: text <=2048 ?
  tier: enum('free', 'pro') ?
  by byScope: scope, id
  immutable scope
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table enumScalar:
  value: enum('a', 'b')

table enumOptional:
  value: enum('a', 'b') ?

table enumList:
  value: [enum('a', 'b')] <=4

table nestedOptionalList:
  value: [enum('a', 'b')] <=4 ?

table textBound:
  value: text <=10

table bytesBound:
  value: bytes <=10

table jsonRequired:
  value: json <=10 ?

table imageRequired:
  value: image <=10 ?

table videoRequired:
  value: video <=10 ?

table mixedEnum:
  value: enum('a', 'b') ?

table disjointEnum:
  -- The repair says to stage this widening before running; this fixture is that staged schema.
  value: enum('a', 'c') ?
