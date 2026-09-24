table items:
  group: text <=20
  until: time ?
  expire at .until
  cap 2
  cap 1 by group
  public
  insert <- allow
  sync public
mutation add(id: id, group: text <=20, until: time ?):
  insert items { id, group, until }
