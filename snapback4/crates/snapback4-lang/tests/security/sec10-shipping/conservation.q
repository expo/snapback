table trips:
  name: text
  read <- allow
  insert <- allow
  online only
table participants:
  trip: trips
  person: principal
  unique trip, person
  immutable trip, person
  read <- allow
  insert <- allow
  delete <- allow
  online only
table ledger:
  trip: trips
  person: principal
  paidCents: int
  kind: enum('charge','refund')
  unique trip, person, kind
  immutable trip, person, paidCents, kind
  read <- allow
  insert <- allow
  update <- deny
  delete <- deny
  online only
mutation add(trip: trips,person: principal):
  insert participants {trip,person}
  return insert ledger {trip,person,paidCents:100,kind:'charge'}
mutation refund(trip: trips,person: principal):
  return insert ledger {trip,person,paidCents:100,kind:'refund'}
mutation remove(entry: participants):
  e = participants[entry] ! else MISSING
  insert ledger {trip:e.trip,person:e.person,paidCents:1,kind:'refund'}
  delete participants[entry]
  
