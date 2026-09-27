# Search completion and work

`check` and `check --cost` distinguish four independent search costs, each
with a source site and rewrite:

- **N_SEARCH_UNSCOPED:** the read rule varies within the searched index.
  Preserve the filters and add `exists members[.conversation, viewer]` to
  enumerate authorized scopes. Hidden physical progress cannot be a cursor.
- **N_SEARCH_OPEN:** every membership and its authorized head must fit one
  read, on every page. Compact keys reduce memory; they do not remove discovery.
  Use the grouped form of `snapback4 guide search` beyond the envelope.
- **N_SEARCH_WORDS:** first-term expansion and further-term misses consume
  the meters. The compact plan repeats word discovery on refills and charges
  it again. Try a longer first term or a pinned chat.
- **N_SEARCH_SHAPE:** `peers: searchPeers(.conversation)` repeats a group
  read per hit. Return a bare hit page and read each chat's details separately.

**E_SEARCH_OPEN** is an incomplete read with a coded refusal, a site and the
grouped rewrite. Its membership count includes only authorized discovered
keys. If discovery was cut, it is explicitly a lower bound: learning the
remaining total would itself exceed the meter. The refusal names the exhausted resource and its ceiling; the card gives the measured fixture envelope. Word width,
filters, row sizes and decoration can reduce that envelope. No budget rises.

No search-work session or stateless multi-pass protocol is implemented.
Ordinary cursors resume emitted order positions in live reads. Restart when
changing the text or membership set; refresh for edited or newly arrived hits.
