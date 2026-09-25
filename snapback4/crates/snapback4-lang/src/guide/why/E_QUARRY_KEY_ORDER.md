# Reads — E_QUARRY_KEY_ORDER

A full positional unique key can be followed by named tests on that row:
`members[org, viewer, role = 'admin']`. The prefix must identify one declared
unique key; inferred indexes never resolve positions. E_QUARRY_KEY_ORDER
means a positional component followed a named one: move all positional
components first, then write the named tests.
