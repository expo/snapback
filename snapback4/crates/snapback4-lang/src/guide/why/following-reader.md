# Internal Following reader refusals

These codes belong to the server integration milestone. It has no public
Following history route, generated binding or hook. They do not change the
completeness or device coverage of the existing inbox or planned history query.

E_FOLLOWING_INPUT rejects an invalid internal opening or token envelope.
E_FOLLOWING_DECLARATION means its declared view is absent; E_FOLLOWING_PAGE_SIZE
requires 1–100 events per internal page. A mismatched issued binding restarts.

E_FOLLOWING_QUOTA refuses a session or frontier allocation without evicting
another consumer. Expired or cancelled state remains charged until bounded
reclamation releases it. E_FOLLOWING_REQUEST_TOO_SMALL means a unit cannot
reserve its work, output and checkpoint under the supplied request ceilings;
the refused unit does not advance. E_FOLLOWING_ROW_TOO_LARGE names an ordered
omission in the metadata reader, which continues beyond that event's key.
Application card shaping and client recovery are still pending integration.

Internal recovery: correct the opening or token envelope before retrying
E_FOLLOWING_INPUT. Use a live declared Following view for
E_FOLLOWING_DECLARATION. For E_FOLLOWING_PAGE_SIZE, request between 1 and 100
events, using a fresh opening if changing an issued binding. For
E_FOLLOWING_QUOTA, run bounded reclaim on expired or cancelled state, then retry
admission. For E_FOLLOWING_REQUEST_TOO_SMALL, retry the same unit only when its
full allowance can be reserved. For E_FOLLOWING_ROW_TOO_LARGE, keep the omission's
event identity and continue with its issued successor.
