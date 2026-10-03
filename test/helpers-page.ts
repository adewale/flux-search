import { vi } from 'vitest';

/**
 * Runs a real frontend page module (frontend/js/*.js) against a minimal
 * DOM stand-in, so tests can assert what the page actually writes into the
 * document instead of grepping its source.
 *
 * The stand-in covers only what the page modules touch: getElementById,
 * innerHTML/textContent/hidden/href, attributes, and querySelector for the
 * one child element a page decorates. Assertions are on the HTML strings the
 * page assigns, which is the input a real browser would parse.
 */
export class FakeElement {
  innerHTML = '';
  textContent = '';
  hidden = true;
  href = '';
  offsetHeight = 0;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  queried: Record<string, FakeElement> = {};
  classList = { add() {}, remove() {} };

  setAttribute(name: string, value: unknown) {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector: string) {
    return (this.queried[selector] ??= new FakeElement());
  }

  querySelectorAll() {
    return [];
  }

  addEventListener() {}
}

export interface PageEnv {
  pathname: string;
  search?: string;
  hash?: string;
  /** JSON body per request path (without query string); missing → 404. */
  api?: Record<string, unknown>;
  /** Extra window properties, e.g. CDN globals such as marked/DOMPurify. */
  windowExtras?: Record<string, unknown>;
}

export interface PageHandle {
  el: (id: string) => FakeElement;
  document: { title: string };
  requests: string[];
}

export function installPageGlobals(env: PageEnv): PageHandle {
  const elements = new Map<string, FakeElement>();
  const el = (id: string) => {
    let e = elements.get(id);
    if (!e) {
      e = new FakeElement();
      elements.set(id, e);
    }
    return e;
  };
  const document = { title: '', getElementById: el };
  const requests: string[] = [];

  vi.stubGlobal('window', {
    location: { pathname: env.pathname, search: env.search ?? '', hash: env.hash ?? '' },
    ...env.windowExtras,
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('history', { replaceState() {} });
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url);
    const path = url.split('?')[0];
    const body = env.api?.[path];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      json: async () => body,
    };
  });

  return { el, document, requests };
}

/** Load a page module fresh (it runs its top-level routing on import). */
export async function loadPage(modulePath: string, env: PageEnv): Promise<PageHandle> {
  const handle = installPageGlobals(env);
  vi.resetModules();
  await import(/* @vite-ignore */ modulePath);
  return handle;
}
