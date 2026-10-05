import { readFileSync } from 'node:fs';
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
 *
 * Elements come from the page's real HTML file: getElementById returns null
 * for an id the markup does not define, and `hidden` starts as the markup
 * sets it. innerHTML and textContent are separate fields, so a test can tell
 * a text write from an HTML write.
 *
 * Not modelled: querySelectorAll returns [], so event handlers wired through
 * it (issue-page section tabs) never run and are not covered here.
 */
export class FakeElement {
  innerHTML = '';
  textContent = '';
  hidden = false;
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
  /** The page's HTML file, e.g. 'frontend/issue.html'; defines its element ids. */
  html: string;
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

function elementsFromHtml(file: string): Map<string, FakeElement> {
  const elements = new Map<string, FakeElement>();
  for (const [tag] of readFileSync(file, 'utf8').matchAll(/<[a-z][^>]*\sid="[^"]+"[^>]*>/g)) {
    const e = new FakeElement();
    e.hidden = /\shidden(?=[\s>=])/.test(tag);
    elements.set(tag.match(/\sid="([^"]+)"/)![1], e);
  }
  return elements;
}

export function installPageGlobals(env: PageEnv): PageHandle {
  const elements = elementsFromHtml(env.html);
  const el = (id: string) => {
    const e = elements.get(id);
    if (!e) throw new Error(`#${id} is not defined in ${env.html}`);
    return e;
  };
  const document = { title: '', getElementById: (id: string) => elements.get(id) ?? null };
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
