import product from '../../../planstrand-product.json';

/** Product identity is independent of the retained upstream compatibility version. */
export const PLANSTRAND_PRODUCT_VERSION = product.version;

/** Omit absent/invalid build metadata rather than exposing generator placeholders. */
export const planstrandBuildRevision = (revision?: string): string | undefined =>
  revision && /^[a-f0-9]{7,40}$/i.test(revision) ? revision.slice(0, 7) : undefined;
