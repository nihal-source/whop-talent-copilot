/**
 * Single import surface for the warm-intro logic that lives in the
 * `@whop-copilot/shared` workspace package (../shared). Keeping it behind one
 * module means the dependency is referenced in exactly one place.
 */
export * from "@whop-copilot/shared";
