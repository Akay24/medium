const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function validateSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": use lowercase letters, digits and hyphens (2-64 chars, starting alphanumeric).`
    );
  }
  return slug;
}
