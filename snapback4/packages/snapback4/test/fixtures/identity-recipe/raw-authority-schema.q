use server
use identity guests

query identityWhoami():
  return viewer

action qualificationMint() retry 4 deadline 30d
action qualificationDeadline() retry 1 deadline 2s
