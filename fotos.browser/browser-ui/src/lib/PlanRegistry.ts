/**
 * Compatibility wrapper for the refactored @refinio/api registry surface.
 *
 * fotos.browser historically imported its registry helpers from this local file.
 * Keep that import path stable, but delegate to the canonical implementation so
 * browser tooling and dev bridges expose the same discovery/invocation contract
 * described in the refinio.api docs.
 */

export {
  OperationRegistry,
  OperationRegistry as PlanRegistry,
  createOperationRegistry,
  createPlanRegistry,
  createPublicOperationCatalogPayload,
  getPublicOperationCatalog,
  getPublicOperationInfo,
  getPublicOperationMetadata,
  hasPublicOperation,
  hasPublicOperationMethod,
} from '@refinio/api/registry';

export type {
  CallResult,
  MethodMetadata,
  OperationInfo,
  OperationMetadata,
  RegisterOptions,
  ToolDefinition,
} from '@refinio/api/registry';
