# Package references: choose the question you need answered

Start a new app with `guide start`, then `guide workflow`.
Long references are embedded in the CLI. Each command lists bounded sections;
open one with `--section <number or heading>`. There is no full-manual read.

- Custom action/route handlers, identity integration or release lifecycle: `guide package-reference server`.
- Client lifecycle, offline behavior or account/avatar/thread walkthrough: `guide package-reference client` (walkthrough: `--section "Your first working account screen"`).
- Offline media custody: `guide package-reference offline-uploads`.
- Version history: `guide package-reference changes` (recent changes: `guide changes`).
- Following migration: `guide package-reference following`.

For this app's calls, arguments, result fields and caller guards, use
`guide api react|client|auth|generated` in your project. With no bound schema
these return the generic signature digest. Other exact signatures: `guide api proof`.
