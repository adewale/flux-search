// Re-export the generated Cloudflare Env type and add secrets that are
// configured outside wrangler.jsonc. All source files import Env from here for
// consistency.
export type Env = globalThis.Env & {
  ADMIN_TOKEN: string;
};
