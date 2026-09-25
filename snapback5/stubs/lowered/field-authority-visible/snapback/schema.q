-- Proposed visibility opt-out, separate from private field authority.
table members:
  principal: principal
  readUpTo: int default 0 written by .principal readable by audience
  public
