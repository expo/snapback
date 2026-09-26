# E_READ_THROUGH_SCAN

E_READ_THROUGH_SCAN refuses a scan of an aggregate grouped by a read-through reference. Read `viewName[parent]` with the complete key. Authorization uses the parent; the child coverage still decides completeness. An unknown device parent or child domain never becomes a zero count.
