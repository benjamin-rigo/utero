export function assertIsolated(isolated: boolean): void {
  if (!isolated) {
    throw new Error(
      'utero needs cross-origin isolation for SharedArrayBuffer. Run it with `npm run dev` / `npm run preview`, or serve it with COOP/COEP headers.',
    )
  }
}
