/** Joins class names, skipping false/empty ones (the `cn` helper UI components expect). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
