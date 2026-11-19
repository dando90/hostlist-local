export const formatHostTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("it-IT") : "—";

export function displayHostValue(value: unknown) {
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? JSON.stringify(item)
          : String(item),
      )
      .join(", ");
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

export function formatHostFieldLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("it-IT"));
}
