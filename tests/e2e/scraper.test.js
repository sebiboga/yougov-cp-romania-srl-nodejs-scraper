import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;

function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

let HAS_ANAF = false;

async function checkAnafAvailability() {
  try {
    const res = await fetch('https://demoanaf.ro/api/search?q=test', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function itIfAnaf(name, fn, timeout) {
  if (HAS_ANAF) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: ANAF API unavailable)`, fn, timeout);
}

beforeAll(async () => {
  HAS_ANAF = await checkAnafAvailability();
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
});

const TEST_CIF = '48869513';
const TEST_BRAND = 'YouGov';
const WORKDAY_API_URL = 'https://yougov.wd103.myworkdayjobs.com/wday/cxs/yougov/YouGov_External_Careers/jobs';

describe('E2E: Full Scraping Pipeline', () => {

  describe('YouGov Workday API — Real Data Fetch', () => {
    let apiData;

    beforeAll(async () => {
      const res = await fetch(WORKDAY_API_URL, {
        method: 'POST',
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: '' })
      });
      apiData = await res.json();
    }, 15000);

    it('should respond with valid job data from Workday API', () => {
      expect(apiData).toHaveProperty('total');
      expect(apiData).toHaveProperty('jobPostings');
      expect(Array.isArray(apiData.jobPostings)).toBe(true);
      expect(typeof apiData.total).toBe('number');
    }, 10000);

    it('should have jobs with expected fields', () => {
      if (apiData.jobPostings.length === 0) {
        console.log('No jobs currently available on YouGov Workday — skipping field assertions');
        return;
      }
      const job = apiData.jobPostings[0];
      expect(job).toHaveProperty('title');
      expect(typeof job.title).toBe('string');
      expect(job).toHaveProperty('externalPath');
      expect(job).toHaveProperty('locationsText');
    });

    it('should have pagination metadata', () => {
      expect(apiData).toHaveProperty('total');
      expect(typeof apiData.total).toBe('number');
      expect(apiData.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let index;
    let apiData;

    beforeAll(async () => {
      index = await import('../../index.js');
      const res = await fetch(WORKDAY_API_URL, {
        method: 'POST',
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: '' })
      });
      apiData = await res.json();
    }, 15000);

    it('should parse real Workday API response into standardized format', () => {
      const result = index.parseApiJobs(apiData);

      expect(result).toHaveProperty('jobs');
      expect(result).toHaveProperty('total');
      expect(result.jobs.length).toBeLessThanOrEqual(5);

      if (result.jobs.length > 0) {
        const parsed = result.jobs[0];
        expect(parsed).toHaveProperty('url');
        expect(parsed.url).toMatch(/^https:\/\/yougov\.wd103\.myworkdayjobs\.com\//);
        expect(parsed).toHaveProperty('title');
        expect(parsed).toHaveProperty('workmode');
        expect(parsed).toHaveProperty('location');
        expect(Array.isArray(parsed.location)).toBe(true);
        expect(parsed).toHaveProperty('tags');
      }
    });

    it('should map parsed jobs to job model', () => {
      const parsed = index.parseApiJobs(apiData);
      if (parsed.jobs.length === 0) {
        console.log('No jobs to map — skipping');
        return;
      }
      const model = index.mapToJobModel(parsed.jobs[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model).toHaveProperty('company');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
      expect(model.url).toMatch(/^https:\/\/yougov\.wd103\.myworkdayjobs\.com\//);
    });

    it('should transform jobs and filter to Romanian locations', () => {
      const parsed = index.parseApiJobs(apiData);
      const jobs = parsed.jobs.map(j => index.mapToJobModel(j, TEST_CIF));

      const payload = {
        source: 'yougov.com',
        company: 'YOUGOV CP ROMANIA S.R.L.',
        cif: TEST_CIF,
        jobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toBe('YOUGOV CP ROMANIA S.R.L.');
      expect(transformed.jobs.length).toBe(jobs.length);

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(Array.isArray(job.location)).toBe(true);
        expect(job.location.length).toBeGreaterThan(0);
      }
    });

    it('should produce valid job URLs that are accessible', async () => {
      const parsed = index.parseApiJobs(apiData);
      if (parsed.jobs.length === 0) {
        console.log('No jobs to verify URL — skipping');
        return;
      }

      for (const job of parsed.jobs.slice(0, 2)) {
        const res = await fetch(job.url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        });
        expect(res.ok).toBe(true);
      }
    }, 30000);
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      company = await import('../../company.js');
    });

    itIfAnaf('should find YouGov in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const yougov = results.find(c =>
        c.name.toUpperCase().startsWith('YOUGOV') &&
        c.statusLabel === 'Funcțiune'
      );
      expect(yougov).toBeDefined();
      expect(yougov.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('YOUGOV CP ROMANIA S.R.L.');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('No YouGov jobs in Solr — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Inactive Company Handling', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
    });

    itIfAnaf('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany('YOUGOV');

      const nonActive = results.find(c => c.statusLabel !== 'Funcțiune');

      if (nonActive) {
        try {
          const anafData = await anaf.getCompanyFromANAF(nonActive.cui.toString());
          expect(anafData).toBeDefined();
          if (anafData.inactive !== undefined) {
            expect(anafData.inactive).toBe(true);
          }
        } catch {
          expect(nonActive.statusLabel).toMatch(/Radiată|Inactiv|Suspendat/);
        }
      }
    }, 30000);
  });

  describe('SOLR Data Verification', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should have YouGov jobs in SOLR with correct company name', async () => {
      const result = await solr.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('No YouGov jobs in Solr — skipping SOLR data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe('YOUGOV CP ROMANIA S.R.L.');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfSolr('should have YouGov company core entry with required fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${TEST_CIF}`);

      expect(result.numFound).toBe(1);
      const yougov = result.docs[0];
      expect(yougov.company).toBe('YOUGOV CP ROMANIA S.R.L.');
      expect(yougov.status).toBe('activ');
    }, 15000);
  });
});
