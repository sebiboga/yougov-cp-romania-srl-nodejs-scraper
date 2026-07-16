/**
 * YouGov CP Romania Job Scraper - Main Entry Point
 * 
 * PURPOSE: Scrapes job listings from YouGov Workday Careers API and stores them in Solr.
 * This is the primary orchestrator that coordinates company validation, job scraping,
 * data transformation, and Solr storage.
 */

import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs, upsertCompany } from "./solr.js";
import { generateJobsMarkdown } from "./src/markdown-generator.js";
import companyConfig from "./config/company.js";

// ============================================================================
// CONFIGURATION CONSTANTS — derived from config/company.json
// ============================================================================

const COMPANY_CIF = companyConfig.cif;
const WORKDAY_BASE = companyConfig.apiBase;
const WORKDAY_PATH = companyConfig.apiPath;

// Request timeout in milliseconds (10 seconds)
const TIMEOUT = 10000;

// Number of jobs to fetch per Workday API page request
const PAGE_SIZE = 20;

// Global variable to store company name after validation
let COMPANY_NAME = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Promise-based sleep function to introduce delays between requests
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Searches ANOFM (Agentia Nationala pentru Ocuparea Fortei de Munca) for
 * job listings belonging to the given company CIF. Uses the public ANOFM API.
 * @param {string} cif - Company CIF
 * @returns {Promise<Array>} - Array of job objects { url, title, location, source }
 */
async function searchANOFM(cif) {
  const jobs = [];
  try {
    console.log(`Searching ANOFM by CIF: ${cif}`);
    const payload = {
      current: 1,
      rowCount: 250,
      sort: { created_at: "desc" },
      employer_tax_code: cif
    };
    const res = await fetch("https://mediere.anofm.ro/api/entity/vw_public_job_posting", {
      method: "POST",
      timeout: TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "job_seeker_ro_spider"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.log(`  ANOFM returned ${res.status}`);
      return jobs;
    }
    const data = await res.json();
    for (const row of data.rows || []) {
      const locationParts = (row.address_locality_name || '').split('>').map(s => s.trim());
      const location = locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
      jobs.push({
        url: `https://mediere.anofm.ro/app/module/mediere/job/${row.id}`,
        title: row.occupation,
        location: location ? [location] : undefined,
        source: "ANOFM"
      });
    }
    console.log(`  Found ${jobs.length} jobs on ANOFM`);
  } catch (err) {
    console.log(`  ANOFM error: ${err.message}`);
  }
  return jobs;
}

// ============================================================================
// API FUNCTIONS - Fetching data from YouGov Workday Careers
// ============================================================================

/**
 * Fetches a single page of jobs from YouGov Workday Careers API
 * @param {number} pageNum - Page number (1-indexed)
 * @returns {Promise<Object>} - API response with job data
 */
async function fetchJobsPage(pageNum) {
  const offset = (pageNum - 1) * PAGE_SIZE;
  const url = `${WORKDAY_BASE}${WORKDAY_PATH}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": "job_seeker_ro_spider",
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset,
      searchText: ""
    }),
    timeout: TIMEOUT
  });
  
  if (!res.ok) {
    throw new Error(`Workday API error ${res.status} for page=${pageNum}`);
  }
  
  const data = await res.json();
  return data;
}

// ============================================================================
// DATA PARSING - Converting Workday API response to our job model
// ============================================================================

/**
 * Parses raw Workday API response into our standardized job format
 * @param {Object} apiData - Raw response from Workday API
 * @returns {Object} - Object containing jobs array and total count
 */
function parseApiJobs(apiData) {
  const postings = apiData.jobPostings || [];
  const total = apiData.total || 0;
  
  return {
    jobs: postings.map(job => {
      const url = `${WORKDAY_BASE}/en-US/YouGov_External_Careers${job.externalPath}`;
      const location = [];
      if (job.locationsText) {
        const parts = job.locationsText.split(',').map(s => s.trim());
        for (const part of parts) {
          if (part && !part.match(/^\d+ Location/)) {
            location.push(part);
          }
        }
      }
      
      const tags = (job.bulletFields || []).filter(Boolean);
      
      return {
        url,
        title: job.title,
        uid: tags[0] || "",
        workmode: "hybrid",
        location,
        tags
      };
    }),
    total
  };
}

// ============================================================================
// SCRAPING LOGIC - Paginated collection of all jobs
// ============================================================================

/**
 * Scrapes all job listings from YouGov Workday by iterating through paginated API responses
 * @param {boolean} testOnlyOnePage - If true, stops after first page (for testing)
 * @returns {Promise<Array>} - Array of unique job objects
 */
async function scrapeAllListings(testOnlyOnePage = false) {
  const allJobs = [];
  const seenUrls = new Set();
  let page = 1;
  let totalJobs = 0;
  const MAX_PAGES = 10;

  while (true) {
    console.log(`Fetching Workday API page: ${page}`);
    const data = await fetchJobsPage(page);
    const result = parseApiJobs(data);
    const jobs = result.jobs;

    if (!jobs.length) {
      console.log(`No jobs found on page ${page}, stopping.`);
      break;
    }

    if (page === 1) {
      totalJobs = result.total;
      console.log(`Total jobs on site: ${totalJobs}`);
    }

    let newJobs = 0;
    for (const job of jobs) {
      if (!seenUrls.has(job.url)) {
        seenUrls.add(job.url);
        allJobs.push(job);
        newJobs++;
      }
    }
    console.log(`Page ${page}: ${jobs.length} jobs, ${newJobs} new (total: ${allJobs.length})`);

    if (testOnlyOnePage) {
      console.log("Test mode: stopping after page 1.");
      break;
    }

    if (page >= MAX_PAGES) {
      console.log(`Max pages (${MAX_PAGES}) reached, stopping.`);
      break;
    }

    if (newJobs === 0) {
      console.log(`No new jobs on page ${page}, stopping.`);
      break;
    }

    page += 1;
    await sleep(1000);
  }

  console.log(`Total unique jobs collected: ${allJobs.length}`);
  return allJobs;
}

// ============================================================================
// DATA TRANSFORMATION - Preparing jobs for Solr storage
// ============================================================================

/**
 * Maps raw job data to Solr-compatible job model with timestamps and status
 * @param {Object} rawJob - Job object from scraper
 * @param {string} cif - Company identifier
 * @param {string} companyName - Company name
 * @returns {Object} - Job object ready for Solr storage
 */
function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    date: now,
    status: "scraped"
  };

  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

/**
 * Transforms jobs to match Solr schema and filters for Romanian locations
 * @param {Object} payload - Job payload with jobs array
 * @returns {Object} - Transformed payload ready for Solr
 */
function transformJobsForSOLR(payload) {
  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni'
  ];

  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

// ============================================================================
// MAIN ORCHESTRATION - Coordinates the entire scraping workflow
// ============================================================================

/**
 * Main function that orchestrates the complete scraping workflow:
 * 1. Check existing jobs in Solr
 * 2. Validate company via ANAF
 * 3. Scrape jobs from YouGov Workday API
 * 4. Transform data for Solr
 * 5. Upsert jobs to Solr
 * 6. Report summary
 */
async function main() {
  const testOnlyOnePage = process.argv.includes("--test");
  
  try {
    fs.mkdirSync("tmp", { recursive: true });
    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_CIF);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);

    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif, address } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;

    try {
      await upsertCompany({
        id: cif,
        company,
        brand: companyConfig.brand,
        status: "activ",
        location: address ? [address] : [companyConfig.defaultLocation],
        website: [companyConfig.website],
        career: [companyConfig.careerUrl],
        lastScraped: new Date().toISOString().split('T')[0],
        scraperFile: companyConfig.scraperFile
      });
    } catch (err) {
      console.log(`Note: Could not upsert company to SOLR core: ${err.message}`);
    }
    
    const rawJobs = await scrapeAllListings(testOnlyOnePage);
    const scrapedCount = rawJobs.length;
    console.log(`Jobs scraped from YouGov Careers website: ${scrapedCount}`);

    if (!testOnlyOnePage) {
      const anofmJobs = await searchANOFM(localCif);
      const anofmCount = anofmJobs.length;
      for (const job of anofmJobs) {
        if (!rawJobs.find(j => j.url === job.url)) {
          rawJobs.push(job);
        }
      }
      console.log(`Jobs added from ANOFM: ${anofmCount}`);
    }

    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "yougov.com",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`Jobs with valid Romanian locations: ${validCount}`);

    fs.writeFileSync("tmp/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved tmp/jobs.json");

    const companyData = {
      id: localCif,
      company: transformedPayload.company,
      brand: companyConfig.brand,
      status: "activ",
      location: address ? [address] : [companyConfig.defaultLocation],
      website: [companyConfig.website],
      career: [companyConfig.careerUrl],
      lastScraped: new Date().toISOString().split('T')[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    fs.writeFileSync("docs/company.json", JSON.stringify(companyConfig, null, 2), "utf-8");
    console.log("Saved docs/company.json");

    console.log("\n=== Step 6: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    const finalResult = await querySOLR(COMPANY_CIF);
    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`Jobs scraped from YouGov website: ${scrapedCount}`);
    console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

// Export functions for testing
export { parseApiJobs, mapToJobModel, transformJobsForSOLR };

// Run main function when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
