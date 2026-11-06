# Fotos gallery

This package exports unbundled TypeScript and TSX through its public package
entries. Its consuming Vite application compiles the UI; ordinary Node execution
of these source entries is not supported. Package names, root imports and the
existing component/library subpaths remain stable, including `.js` import
spellings for source modules.

`pnpm build` creates a normal source package archive in `dist/`; it does not
transpile the UI. `pnpm typecheck` checks the source without emitting JavaScript.
The archive includes the source files needed by public entries.

The consuming application supplies its theme and Tailwind CSS. Include the
installed package source in Tailwind content, for example
`path.join(path.dirname(require.resolve('@refinio/fotos.gallery')), '**/*.{ts,tsx}')`.
Resolve the installed public entry instead of a sibling checkout. Keep the
application's existing theme variables and React provider contract.
