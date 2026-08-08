// Setup for the jsdom (component) project only — see vitest.config.ts.
// Adds the DOM matchers (toBeInTheDocument, toBeDisabled, ...) to expect().
// RTL's automatic cleanup between tests is enabled by `globals: true`.
import '@testing-library/jest-dom/vitest';
