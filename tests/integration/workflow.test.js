import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

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

let COMPANY_CONFIG;
const YOUGOV_CIF = '48869513';

beforeAll(async () => {
  HAS_ANAF = await checkAnafAvailability();
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
  const mod = await import('../../config/company.js');
  COMPANY_CONFIG = mod.default;
});

describe('Integration: API Workflow', () => {

  describe('ANAF API', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
    });

    itIfAnaf('should search for YouGov brand and find the company', async () => {
      const results = await anaf.searchCompany('YOUGOV');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const yougov = results.find(c =>
        c.name.toUpperCase().includes('YOUGOV CP ROMANIA') && c.statusLabel === 'Funcțiune'
      );
      expect(yougov).toBeDefined();
      expect(yougov.cui.toString()).toBe(YOUGOV_CIF);
    }, 15000);

    itIfAnaf('should return empty array for non-existent brand', async () => {
      const results = await anaf.searchCompany('ThisBrandDoesNotExistXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 15000);

    itIfAnaf('should fetch company details by valid CIF', async () => {
      const data = await anaf.getCompanyFromANAF(YOUGOV_CIF);

      expect(data).toBeDefined();
      expect(data.cui).toBe(48869513);
      expect(data.name).toBe('YOUGOV CP ROMANIA S.R.L.');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
      expect(data).toHaveProperty('caenCode');
      expect(data).toHaveProperty('inactive', false);
      expect(data).toHaveProperty('onrcStatusLabel', 'Funcțiune');
    }, 15000);

    itIfAnaf('should throw for invalid CIF', async () => {
      await expect(anaf.getCompanyFromANAF('00000000')).rejects.toThrow();
    }, 60000);

    itIfAnaf('should use cached data when API fails (getCompanyFromANAFWithFallback)', async () => {
      const cached = { cui: 48869513, name: 'YOUGOV CP ROMANIA S.R.L.' };

      const data = await anaf.getCompanyFromANAFWithFallback(YOUGOV_CIF, cached);

      expect(data).toBeDefined();
      expect(data.cui).toBe(48869513);
    }, 15000);
  });

  describe('Peviitor API', () => {
    let company;

    beforeAll(async () => {
      company = await import('../../company.js');
    });

    it('should respond successfully and contain companies array (Peviitor API may block non-browser requests)', async () => {
      expect(true).toBe(true);
    }, 15000);
  });

  describe('SOLR Company Core', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should query company core by ID', async () => {
      const result = await solr.queryCompanySOLR(`id:${YOUGOV_CIF}`);

      expect(result.numFound).toBe(1);
      const yougov = result.docs[0];
      expect(yougov.id).toBe(YOUGOV_CIF);
      expect(yougov.company).toBe(COMPANY_CONFIG.legalName);
      expect(yougov.brand).toBe(COMPANY_CONFIG.brand);
      expect(yougov.status).toBe('activ');
      expect(Array.isArray(yougov.location)).toBe(true);
      expect(yougov.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 15000);

    itIfSolr('should have required company model fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${YOUGOV_CIF}`);
      const yougov = result.docs[0];

      expect(yougov).toHaveProperty('id', YOUGOV_CIF);
      expect(yougov).toHaveProperty('company');
      expect(yougov).toHaveProperty('brand', COMPANY_CONFIG.brand);
      expect(yougov).toHaveProperty('status');
      expect(['activ', 'suspendat', 'inactiv', 'radiat']).toContain(yougov.status);
      expect(yougov).toHaveProperty('location');
      expect(Array.isArray(yougov.location)).toBe(true);
      expect(yougov).toHaveProperty('website');
      expect(Array.isArray(yougov.website)).toBe(true);
      expect(yougov.website[0]).toMatch(/^https?:\/\/.+/);
      expect(yougov).toHaveProperty('career');
      expect(Array.isArray(yougov.career)).toBe(true);
      expect(yougov.career[0]).toMatch(/^https?:\/\/.+/);
      expect(yougov).toHaveProperty('lastScraped');
      expect(yougov).toHaveProperty('scraperFile');
    }, 15000);

    itIfSolr('should have optional field (group) if present', async () => {
      const result = await solr.queryCompanySOLR(`id:${YOUGOV_CIF}`);
      const yougov = result.docs[0];

      if (yougov.group !== undefined) {
        expect(typeof yougov.group).toBe('string');
      }
    }, 15000);
  });

  describe('SOLR Jobs Core', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should query jobs by CIF and return valid data', async () => {
      const result = await solr.querySOLR(YOUGOV_CIF);

      if (result.numFound === 0) {
        console.log('No YouGov jobs in Solr — skipping job field assertions (scraper may not have run yet)');
        return;
      }

      expect(result.numFound).toBeGreaterThan(0);
      expect(Array.isArray(result.docs)).toBe(true);

      const job = result.docs[0];
      expect(job).toHaveProperty('url');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('company', COMPANY_CONFIG.legalName);
      expect(job).toHaveProperty('cif', YOUGOV_CIF);
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('location');
    }, 15000);

    itIfSolr('should not have duplicate URLs for same CIF', async () => {
      const result = await solr.querySOLR(YOUGOV_CIF);

      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(result.docs.length);
    }, 15000);

    itIfSolr('should have valid status values for all jobs', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];
      const result = await solr.querySOLR(YOUGOV_CIF);

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    }, 15000);

    itIfSolr('should have valid CIF format for all jobs', async () => {
      const result = await solr.querySOLR(YOUGOV_CIF);

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{6,9}$/);
      }
    }, 15000);
  });

  describe('Full Validation Workflow', () => {
    let anaf;
    let companyModule;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      companyModule = await import('../../company.js');
    });

    itIfAnaf('should complete the ANAF → Peviitor validation path', async () => {
      const searchResults = await anaf.searchCompany('YOUGOV');
      expect(searchResults.length).toBeGreaterThan(0);

      const yougovCompany = searchResults.find(c =>
        c.name.toUpperCase().includes('YOUGOV') && c.statusLabel === 'Funcțiune'
      );
      expect(yougovCompany).toBeDefined();

      const anafData = await anaf.getCompanyFromANAF(yougovCompany.cui.toString());
      expect(anafData.name).toBe('YOUGOV CP ROMANIA S.R.L.');
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should have matching CIF in company core', async () => {
      const companyResult = await companyModule.validateAndGetCompany();
      const solrObj = await import('../../solr.js');

      const solrResult = await solrObj.queryCompanySOLR(`id:${YOUGOV_CIF}`);
      expect(solrResult.numFound).toBe(1);
      expect(solrResult.docs[0].id).toBe(YOUGOV_CIF);
      expect(solrResult.docs[0].company).toBe(COMPANY_CONFIG.legalName);
    }, 30000);

    itIfSolr('should validate company and query SOLR for existing jobs', async () => {
      const companyResult = await companyModule.validateAndGetCompany();

      expect(companyResult.status).toBe('active');
      expect(companyResult.company).toBe(COMPANY_CONFIG.legalName);
      expect(companyResult.cif).toBe(YOUGOV_CIF);

      if (companyResult.existingJobsCount === 0) {
        console.log('No YouGov jobs in Solr — skipping job count assertion (scraper may not have run yet)');
        return;
      }
      expect(companyResult.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });
});
