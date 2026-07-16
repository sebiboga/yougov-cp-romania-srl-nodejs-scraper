# job_seeker_ro_spider — YouGov CP Romania Scraper

[![Oportunitati SI Cariere](https://github.com/sebiboga/yougov-cp-romania-srl-nodejs-scraper/actions/workflows/job-seeker-ro-spider.yml/badge.svg)](https://github.com/sebiboga/yougov-cp-romania-srl-nodejs-scraper/actions/workflows/job-seeker-ro-spider.yml)
[![Automation Tests](https://github.com/sebiboga/yougov-cp-romania-srl-nodejs-scraper/actions/workflows/automation-testing.yml/badge.svg)](https://github.com/sebiboga/yougov-cp-romania-srl-nodejs-scraper/actions/workflows/automation-testing.yml)

[![Version](https://img.shields.io/github/package-json/v/sebiboga/yougov-cp-romania-srl-nodejs-scraper?label=version&color=blue)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/javascript-ESM-F7DF1E?logo=javascript&logoColor=black)](https://ecma-international.org/)
[![Node.js](https://img.shields.io/badge/node-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fpeviitor.ro&label=peviitor.ro)](https://peviitor.ro)

**job_seeker_ro_spider** — un scraper pentru job-urile YouGov CP Romania S.R.L. (CIF: 48869513). Extrage anunțurile de pe [YouGov Careers](https://jobs.yougov.com) (Workday API) și le publică în [peviitor.ro](https://peviitor.ro) prin API-ul SOLR.

> **Derived from [EPAM template](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper)** — this scraper uses the Workday JSON API for job listings.

## Overview

Proiectul automatizează colectarea zilnică a job-urilor YouGov din România, menținând board-ul peviitor.ro la zi cu cele mai recente oportunități de carieră.

## Features

- Extrage job-uri din YouGov Workday Careers API (JSON)
- Validează compania via ANAF (CIF 48869513, status activ, adresă completă)
- Cross-validează cu Peviitor API
- Stochează în SOLR (job core + company core)
- Generează `docs/jobs.md` automat — accesibil pe GitHub Pages
- **Identitate companie într-un singur fișier** (`config/company.json`)
- GitHub Actions: scrape zilnic + testare automată (unit, integration, e2e, consistency)

## Architecture

```
config/company.json  →  Single source of truth for company identity
index.js             →  Main scraper (Workday API + ANOFM)
company.js           →  ANAF validation
solr.js              →  SOLR storage
src/anaf.js          →  ANAF API client
tests/               →  Unit, integration, E2E, consistency tests
docs/                →  GitHub Pages dashboard
```

## Setup

1. Clone the repo
2. Run `npm install`
3. Set `SOLR_AUTH` environment variable
4. Run `npm run scrape`

## Testing

```bash
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests (needs SOLR_AUTH)
npm run test:e2e           # E2E tests (needs network)
npm run test:consistency   # Consistency tests (needs GITHUB_REPOSITORY)
npm test                   # All tests
```

## Company Details

| Field | Value |
|---|---|
| CIF | 48869513 |
| Legal Name | YOUGOV CP ROMANIA S.R.L. |
| Brand | YouGov |
| Website | https://yougov.com |
| Career | https://jobs.yougov.com |
| Workday API | https://yougov.wd103.myworkdayjobs.com |
| Default Location | București |

## Derived From

This scraper was derived from the [EPAM template](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper).

## License

MIT
