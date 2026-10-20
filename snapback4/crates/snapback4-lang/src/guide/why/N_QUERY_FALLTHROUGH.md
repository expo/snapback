# N_QUERY_FALLTHROUGH

N_QUERY_FALLTHROUGH: A query can reach the end without returning a result.

The named source path returns null for compatibility. Add `return []` for an intentional empty list or `return null` for absence. A final expression returns implicitly; a return inside a possibly empty loop does not cover zero iterations. This advice does not prove read completeness. Guide programs.
