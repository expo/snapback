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
