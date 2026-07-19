import { afterEach, describe, expect, it, vi } from 'vitest';
import { initAutocomplete } from '../frontend/js/lib/autocomplete.js';

type Listener = (event: any) => void;

class FakeElement {
  value = '';
  hidden = true;
  innerHTML = '';
  dataset: Record<string, string> = {};
  private listeners = new Map<string, Listener[]>();
  private attributes = new Map<string, string>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  contains() {
    return false;
  }

  querySelectorAll() {
    return [];
  }

  focus() {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('autocomplete request ownership', () => {
  it('does not reopen suggestions after the input is cleared', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { addEventListener() {} });

    const pending = deferred<Array<{ value: string }>>();
    const input = new FakeElement();
    const dropdown = new FakeElement();
    initAutocomplete(input as any, dropdown as any, {
      fetchSuggestions: () => pending.promise,
      onSelect() {},
    });

    input.value = 'tr';
    input.emit('input');
    await vi.advanceTimersByTimeAsync(200);

    input.value = '';
    input.emit('input');
    pending.resolve([{ value: 'trust' }]);
    await vi.runAllTimersAsync();

    expect(dropdown.hidden).toBe(true);
    expect(dropdown.innerHTML).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores an older response that arrives after a newer query', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { addEventListener() {} });

    const first = deferred<Array<{ value: string }>>();
    const second = deferred<Array<{ value: string }>>();
    const input = new FakeElement();
    const dropdown = new FakeElement();
    initAutocomplete(input as any, dropdown as any, {
      fetchSuggestions: (q: string) => q === 'tr' ? first.promise : second.promise,
      onSelect() {},
    });

    input.value = 'tr';
    input.emit('input');
    await vi.advanceTimersByTimeAsync(200);
    input.value = 'tru';
    input.emit('input');
    await vi.advanceTimersByTimeAsync(200);

    second.resolve([]);
    await vi.runAllTimersAsync();
    first.resolve([{ value: 'trust' }]);
    await vi.runAllTimersAsync();

    expect(dropdown.hidden).toBe(true);
    expect(dropdown.innerHTML).toBe('');
  });
});
