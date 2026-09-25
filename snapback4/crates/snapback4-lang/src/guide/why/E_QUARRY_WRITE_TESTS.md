# Writes — E_QUARRY_WRITE_TESTS

E_QUARRY_WRITE_TESTS means a write target includes tests beyond its unique
key. For a readable row, write `require exists members[org, viewer, role =
'admin'] else NOT_ADMIN`, then `update members[org, viewer] { role: 'member' }`.
Choose the refusal code for your application. This explicit check refuses a
hidden or missing row and grants no write authority; the compiler does not
insert it automatically.
