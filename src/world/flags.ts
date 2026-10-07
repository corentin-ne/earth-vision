/** ISO 3166 alpha-3 → alpha-2, used to find the bundled flag of real-world countries. */
export const iso2: Record<string, string> = {};

let loading: Promise<void> | null = null;
export function loadIso2(): Promise<void> {
  loading ??= fetch(new URL('data/iso3to2.json', document.baseURI))
    .then((r) => r.json())
    .then((m: Record<string, string>) => {
      Object.assign(iso2, m);
    })
    .catch(() => {});
  return loading;
}
