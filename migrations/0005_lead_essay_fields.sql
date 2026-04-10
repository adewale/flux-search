-- Add fields for the intrinsic structure of FLUX Review issues.
-- Each issue has an opening quote and a lead essay with its own title.
-- These are more useful for search display than the generic Substack title.

ALTER TABLE issues ADD COLUMN lead_essay_title TEXT;
ALTER TABLE issues ADD COLUMN opening_quote TEXT;
