# Contributing

## For YouGov Scraper

This repo is a **derived scraper** — it scrapes YouGov job listings for Romania and publishes them to peviitor.ro.

### Development

```bash
npm install              # install dependencies
npm run test:unit        # run unit tests
npm run test:integration # run integration tests
npm run test:e2e         # run e2e tests (needs real network + SOLR)
```

### Key Files

| File | Description |
|---|---|
| `config/company.json` | Company identity and API config |
| `index.js` | Main scraper logic |
| `src/` | Shared utilities (solr, demoanaf, etc.) |
| `tests/` | Unit/integration/e2e tests |

### Updating for New Companies

To derive a new scraper from this repo:

1. Fork this repo or use `--template` flag
2. Update `config/company.json` with new company identity
3. Rewrite scraper logic in `index.js` for new data source
4. Update all test files (search for remaining EPAM/YouGov references)
5. Update docs, workflows, and README
6. Verify CI passes

### CI

- `job-seeker-ro-spider.yml` — runs the scraper on schedule (Mon-Fri 06:00)
- `automation-testing.yml` — runs validation tests on schedule

### Secrets

- `SOLR_AUTH` — required for SOLR upsert/delete operations
