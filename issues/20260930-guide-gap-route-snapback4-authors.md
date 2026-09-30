# Guide gap: route Snapback 4 authors to the correct guide

The root `guide/index.md` is required reading before building an app on
Snapback, but it describes the older Snapback schema, CLI and client surface.
During the 2026-09-30 workout tracker comparison targeting `snapback4@0.4.9`,
it did not tell me to switch to the Snapback 4 package guide. I found the
working `init --web`, schema, auth and React instructions in
`snapback4/README.md` and the installed package instead.

Add an explicit routing note near the top of `guide/index.md` for people
building with `snapback4`, pointing to the versioned Snapback 4 guide or
package documentation. Keep the existing guide's scope clear so an author
does not combine incompatible API examples. This is a documentation task;
the workout tracker itself does not depend on it.
