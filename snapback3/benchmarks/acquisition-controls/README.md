# Acquisition safety controls

`controller.mjs` runs the full candidate application and public SDK against a
fresh copy of the retained 10,000-message fixture for each scenario. It sends
one message at early, middle, and late durable acquisition progress, waits for
the original operation receipt and a ready acquisition at that sequence, then
checks an independent recipient and a physical browser reopen in actual
network-offline mode. The offline audit follows every ordinary SDK cursor and
binds the unchanged 10,000 baseline rows to the retained canonical digest plus
the one exact added row.

A fourth send control drops the first committed `messages.send` response at a
proxy after consuming it. The unchanged durable operation must recover the
owner receipt under its original intent ID and still produce exactly one row.

The interruption scenario closes the browser after a durable acquisition prefix,
reopens online with the same declaration, waits for the resumed cycle, and
audits all 10,000 rows with browser networking disabled. Each scenario keeps a
private browser profile and database copy. The controller records source,
package, fixture, process, timing, progress, receipt, and cleanup evidence.

Only ports 54928 and 54929 are accepted. The second origin is an HTTP proxy to
the same owner so the recipient has independent browser storage and an
independently authenticated application singleton without a second database
writer.
