# Fotos native support

Private source-only bootstrap and Metro/Babel configuration shared by the phone
and TV apps in this repository. Final native apps compile the bootstrap and
install its platform providers explicitly. There is no independent runtime or
published package. Application typechecks, tests and Metro exports cover its
consumers. Its build only packs the declared source/tools for Turbo dependency
hashing and artifact checks; it does not transpile source or emit another
package's files.
