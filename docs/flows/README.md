# Fotos Flows

Status: Living engineering reference
Owner: fotos product and engineering
Last updated: 2026-09-22
Related: [UI flow inventory](../product/ui.prd.md), [Explicit sharing epic](../product/ui/sharing.epic.md),
[D-03 sharing revocation](../product/ui/decisions/D-03-sharing-revocation.md),
[Integrated QA protocol](../product/testing.md), [App Book](../../fotos.browser/app-book.mjs)

The product documents say what a flow must achieve. The flow documents here say how
the current runtime achieves it: the order of durable writes, what each actor
observes, how failures leave state, and which executable evidence proves each
step. Each flow names the `F<n>` rows of the UI flow inventory it realizes, so the
coverage map in `fotos-flow-coverage.mjs` and these documents describe the same
behavior.

| Flow | Actors | Inventory rows | Primary evidence |
|---|---|---|---|
| [01 Publish or change scope access](01-publish-scope-access.md) | Publisher | F74–F76, F79 | Unit contracts, named-identity protocol, Filer/Fotos protocol steps 5–7, 10–11 |
| [02 Receive a shared scope](02-receive-shared-scope.md) | Recipient browser, recipient Filer | F72–F73 | Unit contracts, named-identity protocol, Filer/Fotos protocol steps 5–11 |
| [03 Gallery invitation](03-gallery-invitation.md) | Publisher, guest recipient | F12, F68–F72 | Ad-hoc gallery invitation protocol |

## Conventions

- **Durable** means persisted in ONE storage or product settings and restored after a
  page or runtime reload. In-memory coordination is named as such.
- Step lists follow the runtime order. When order is a security property, the step
  says so and names the test that enforces it.
- "Runner coverage" lists evidence that runs today. "Gaps" lists behavior no test
  proves yet; it is not a backlog of desired features.
