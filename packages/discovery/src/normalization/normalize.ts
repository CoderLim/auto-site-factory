export function normalizeEntityName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*([:/|])\s*/g, "$1")
    .toLocaleLowerCase("en-US")
}
