export var SECTION_LABELS = {
  lead_essay: 'Essay',
  signposts: 'Signposts',
  worth_your_time: 'Worth your time',
  lens: 'Lens of the week',
  book: 'Book',
  postcard: 'Postcard from the future',
  fluxers: 'More from FLUXers',
  body: 'Body',
  title_summary: 'Title',
  other: 'Other',
};

export function formatSectionLabel(type) {
  if (!type) return null;
  return SECTION_LABELS[type] || type;
}
