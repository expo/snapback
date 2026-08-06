# Tandem Snapback native shell

This directory is the isolated EAS input for the installable development
client. It mirrors the parent app's native dependencies and Expo config but
deliberately omits Snapback's Rust monorepo and all product JavaScript. The
installed shell loads the real app from the parent project's verified Metro
server.

Build through `../../scripts/build-ios-dev-client snapback`. The helper stages
this shell outside the checkout so EAS does not archive the monorepo root.
