/** Netlify supplies CONTEXT during the build, but not in Functions at runtime. */
export function deploymentContext(
  buildContext = process.env.PARKES_DEPLOY_CONTEXT,
  runtimeContext = process.env.CONTEXT,
): string {
  // Keep the direct env reference above so Next can embed the trusted build
  // value. Runtime fallback is for unbundled local tools and test fixtures.
  return buildContext || runtimeContext || '';
}

export function isProductionDeployment(): boolean {
  return deploymentContext() === 'production';
}
