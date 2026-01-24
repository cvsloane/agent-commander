# Search and Projects

Agent Commander includes global search and a lightweight project index.

## Global search

`GET /v1/search` searches across:
- Sessions
- Events
- Snapshots

Search uses full text indexes. If you see a search index error, run migration `006_search.sql`.

## Projects

Projects are a per user view of repos that have been active in sessions. Use them to jump back into work quickly.

`GET /v1/projects` supports filtering by host and query.
