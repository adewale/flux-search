export type State = {
  name: 'LANDING_FEATURED' | 'LANDING' | 'RESULTS' | 'BROWSING';
  query: string;
  quoteVisible: boolean;
  autoLoadLatest: boolean;
  clearVisible: boolean;
  resultsVisible: boolean;
  booted: boolean;
};

export type Event =
  | { type: 'LOAD'; query: string }
  | { type: 'SUBMIT'; query: string }
  | { type: 'EXAMPLE'; query: string }
  | { type: 'FACET'; section: string }
  | { type: 'REFINE'; append: string }
  | { type: 'DISMISS' }
  | { type: 'POPSTATE'; query: string };

export function reduce(state: State, event: Event): State;

export function createSearchMachine(): {
  readonly state: State;
  send(event: Event): State;
};
