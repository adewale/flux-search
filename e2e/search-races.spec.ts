import { expect, test, type Page, type Route } from '@playwright/test';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settleBrowserWork(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

function searchResponse(title: string, issueNumber: number, totalHits = 1) {
  return {
    parsed_query: { free_text: title, phrases: [], filters: {} },
    applied_filters: [],
    total_hits: totalHits,
    year_distribution: {},
    quarter_distribution: {},
    section_facets: {},
    results: [{
      issue_id: String(issueNumber),
      title,
      issue_number: issueNumber,
      published_at: '2026-01-01',
      snippet: `${title} snippet`,
      snippet_section: 'lead_essay',
      confidence: 'high',
      canonical_url: `https://example.com/${issueNumber}`,
      matched_by: ['fts'],
      topics: [],
    }],
  };
}

test.describe('async search ownership', () => {
  test('typing before latest-issue resolves is never overwritten', async ({ page }) => {
    const latest = deferred<{ issue_number: number }>();
    await page.route('**/latest-issue', async (route) => {
      await route.fulfill({ json: await latest.promise });
    });
    await page.route('**/random-quote', (route) => route.fulfill({ json: {} }));

    await page.goto('/');
    await page.fill('#search-input', 'trust');
    const latestResponse = page.waitForResponse('**/latest-issue');
    latest.resolve({ issue_number: 243 });
    await latestResponse;
    await settleBrowserWork(page);

    await expect(page.locator('#search-input')).toHaveValue('trust');
  });

  test('an older search response cannot replace newer results', async ({ page }) => {
    const replies = {
      old: deferred<ReturnType<typeof searchResponse>>(),
      new: deferred<ReturnType<typeof searchResponse>>(),
    };
    const completed = {
      old: deferred<void>(),
      new: deferred<void>(),
    };
    const requested = new Set<string>();

    await page.route('**/search?**', async (route: Route) => {
      const q = new URL(route.request().url()).searchParams.get('q');
      if (q !== 'old' && q !== 'new') return route.continue();
      requested.add(q);
      await route.fulfill({ json: await replies[q].promise });
      completed[q].resolve();
    });

    await page.goto('/?q=old');
    await expect.poll(() => requested.has('old')).toBe(true);

    await page.fill('#search-input', 'new');
    await page.press('#search-input', 'Enter');
    await expect.poll(() => requested.has('new')).toBe(true);

    replies.new.resolve(searchResponse('New result', 2));
    await completed.new.promise;
    await expect(page.locator('.result-title')).toHaveText('New result');

    const oldResponse = page.waitForResponse((response) =>
      new URL(response.url()).searchParams.get('q') === 'old',
    );
    replies.old.resolve(searchResponse('Old result', 1));
    await completed.old.promise;
    await oldResponse;
    await settleBrowserWork(page);
    await expect(page.locator('.result-title')).toHaveText('New result');
  });

  test('a delayed landing quote cannot surface over user search results', async ({ page }) => {
    const quote = deferred<{ quote: string; issue_number: number; title: string }>();
    const quoteCompleted = deferred<void>();

    await page.route('**/latest-issue', (route) => route.fulfill({ json: {} }));
    await page.route('**/random-quote', async (route) => {
      await route.fulfill({ json: await quote.promise });
      quoteCompleted.resolve();
    });
    await page.route('**/search?**', (route) => route.fulfill({
      json: searchResponse('User result', 1),
    }));

    await page.goto('/');
    await page.fill('#search-input', 'trust');
    await page.press('#search-input', 'Enter');
    await expect(page.locator('.result-title')).toHaveText('User result');

    quote.resolve({ quote: 'Late quote', issue_number: 1, title: 'Old landing' });
    await quoteCompleted.promise;
    await settleBrowserWork(page);

    await expect(page.locator('#landing-quote')).toBeHidden();
    await expect(page.locator('.result-title')).toHaveText('User result');
  });

  test('a search response loses ownership after navigation returns to landing', async ({ page }) => {
    const reply = deferred<ReturnType<typeof searchResponse>>();
    const completed = deferred<void>();
    let requested = false;

    await page.route('**/search?**', async (route: Route) => {
      requested = true;
      await route.fulfill({ json: await reply.promise });
      completed.resolve();
    });
    await page.route('**/random-quote', (route) => route.fulfill({ json: {} }));

    await page.goto('/?q=old');
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#search-input')).toHaveValue('');

    reply.resolve(searchResponse('Late result', 1));
    await completed.promise;
    await settleBrowserWork(page);

    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('#loading')).toBeHidden();
  });

  test('page ownership follows initial URL and same-query history navigation', async ({ page }) => {
    await page.route('**/search?**', async (route: Route) => {
      const url = new URL(route.request().url());
      const pageNumber = Number(url.searchParams.get('page') || '1');
      await route.fulfill({
        json: searchResponse(`Page ${pageNumber}`, pageNumber, 40),
      });
    });

    await page.goto('/?q=pages&page=2');
    await expect(page.locator('.result-title')).toHaveText('Page 2');
    await page.getByRole('button', { name: '← Prev' }).click();
    await expect(page.locator('.result-title')).toHaveText('Page 1');

    await page.goBack();
    await expect(page.locator('.result-title')).toHaveText('Page 2');
    await expect(page).toHaveURL(/\?q=pages&page=2$/);
  });

  test('an older autocomplete response cannot reopen the dropdown', async ({ page }) => {
    const replies = {
      tr: deferred<{ suggestions: Array<{ value: string }> }>(),
      tru: deferred<{ suggestions: Array<{ value: string }> }>(),
    };
    const completed = {
      tr: deferred<void>(),
      tru: deferred<void>(),
    };
    const requested = new Set<string>();

    await page.route('**/autocomplete?**', async (route: Route) => {
      const q = new URL(route.request().url()).searchParams.get('q');
      if (q !== 'tr' && q !== 'tru') return route.continue();
      requested.add(q);
      await route.fulfill({ json: await replies[q].promise });
      completed[q].resolve();
    });

    await page.goto('/?q=seed');
    await page.fill('#search-input', 'tr');
    await expect.poll(() => requested.has('tr')).toBe(true);
    await page.fill('#search-input', 'tru');
    await expect.poll(() => requested.has('tru')).toBe(true);

    replies.tru.resolve({ suggestions: [] });
    await completed.tru.promise;
    replies.tr.resolve({ suggestions: [{ value: 'trust' }] });
    await completed.tr.promise;
    await settleBrowserWork(page);

    await expect(page.locator('#search-input')).toHaveValue('tru');
    await expect(page.locator('#autocomplete-dropdown')).toBeHidden();
    await expect(page.locator('.autocomplete-item')).toHaveCount(0);
  });
});
