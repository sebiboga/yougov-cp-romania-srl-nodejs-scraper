# AGENTS.md — Rules for AI agents

## Project
YouGov CP Romania scraper for peviitor.ro (Node.js, ESM, Jest)

## This Repo Is a Derived Scraper
This repo is a **derived scraper** for YouGov CP Romania S.R.L. (CIF: 48869513), scraped from the YouGov Workday Careers API. It was derived from the [EPAM template](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper).

## Critical Rules

### 0. Background tasks — always pass `--repo` explicitly to `gh`

When polling a workflow run, the `gh run view` command implicitly uses the current working directory's git remote. If the CWD is a different repo, `gh` looks in the wrong repo.

**Always specify the repo explicitly:**
```bash
gh run view <RUN_ID> --repo sebiboga/yougov-cp-romania-srl-nodejs-scraper --json status -q .status
```

### 1. Company identity lives in `config/company.json`
All company-specific identity (CIF, brand, legalName, URLs) is in `config/company.json`. Read from `config/company.js` in Node code, or via `jq` in workflows. Never hardcode in source files.

### 2. Scraper logic is in `index.js`
Only the `fetchJobs*()` and `parse*Jobs()` functions are company-specific. The rest (mapping, SOLR upsert, markdown) is generic.

### 3. Never commit secrets
Never commit `SOLR_AUTH`, GitHub tokens, or any other secrets. Use environment variables.

### 4. ANAF validation
The scraper validates the company via ANAF before scraping. If ANAF returns `inactive: true`, the scraper logs a warning but continues (jobs may still exist).

### 5. ANOFM integration
The scraper also checks ANOFM (Agentia Nationala pentru Ocuparea Fortei de Munca) for jobs posted by this company.

### 6. SOLR upsert
Jobs are upserted to SOLR. The `_version_` field must be stripped from existing jobs before re-upserting to avoid 409 conflicts.

### 7. Workday API
The scraper uses the Workday JSON API (`POST /wday/cxs/yougov/YouGov_External_Careers/jobs`) to fetch job listings. The API supports pagination via `offset` and `limit` parameters.
