DROP TABLE IF EXISTS search_fts;

CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body,
  code,
  tokenize = 'unicode61'
);
