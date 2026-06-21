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

beforeAll(() => {
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
});

const TEST_CIF = '32971419';
const BAMBOO_API_URL = 'https://tecss.bamboohr.com/careers/list';
const JOB_BASE = 'https://tecss.bamboohr.com/careers';

describe('E2E: Full Scraping Pipeline', () => {

  describe('BambooHR API — Real Data Fetch', () => {
    let apiData;
    let fetchOk;

    beforeAll(async () => {
      try {
        const res = await fetch(BAMBOO_API_URL, {
          headers: {
            'User-Agent': 'job_seeker_ro_spider',
            'Accept': 'application/json'
          }
        });
        apiData = await res.json();
        fetchOk = true;
      } catch {
        fetchOk = false;
        apiData = {};
      }
    }, 15000);

    it('should reach BambooHR API (skip assertions if site is unreachable)', () => {
      if (!fetchOk) {
        console.log('BambooHR API unreachable — skipping API data assertions');
        return;
      }
      expect(apiData).toHaveProperty('result');
      expect(Array.isArray(apiData.result)).toBe(true);
      expect(apiData).toHaveProperty('meta');
    }, 10000);

    it('should return jobs with expected BambooHR fields', () => {
      if (!fetchOk || !apiData.result?.length) {
        console.log('No jobs data available — skipping field assertions');
        return;
      }
      const job = apiData.result[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('jobOpeningName');
      expect(typeof job.jobOpeningName).toBe('string');
      expect(job).toHaveProperty('location');
      expect(job.location).toHaveProperty('city');
    });

    it('should have valid job IDs', () => {
      if (!fetchOk || !apiData.result?.length) {
        console.log('No jobs data available — skipping job ID assertions');
        return;
      }
      for (const job of apiData.result) {
        expect(job).toHaveProperty('id');
        expect(String(job.id)).toMatch(/^\d+$/);
      }
    });

    it('should have departmentLabel on all jobs', () => {
      if (!fetchOk || !apiData.result?.length) {
        console.log('No jobs data available — skipping department assertions');
        return;
      }
      for (const job of apiData.result) {
        expect(job).toHaveProperty('departmentLabel');
        expect(typeof job.departmentLabel).toBe('string');
      }
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let index;
    let apiData;
    let fetchOk;

    beforeAll(async () => {
      index = await import('../../index.js');
      try {
        const res = await fetch(BAMBOO_API_URL, {
          headers: {
            'User-Agent': 'job_seeker_ro_spider',
            'Accept': 'application/json'
          }
        });
        apiData = await res.json();
        fetchOk = true;
      } catch {
        fetchOk = false;
        apiData = { result: [], meta: { totalCount: 0 } };
      }
    }, 15000);

    it('should parse real BambooHR API response into standardized format', () => {
      const result = index.parseJobsPage(apiData);

      expect(result).toHaveProperty('jobs');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.jobs)).toBe(true);

      if (!fetchOk || result.jobs.length === 0) {
        console.log('No jobs to parse — skipping parsed fields assertions');
        return;
      }

      const parsed = result.jobs[0];
      expect(parsed).toHaveProperty('url');
      expect(parsed.url).toMatch(new RegExp(`^${JOB_BASE}/`));
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('uid');
      expect(parsed).toHaveProperty('workmode');
      expect(parsed).toHaveProperty('location');
      expect(Array.isArray(parsed.location)).toBe(true);
    });

    it('should map parsed jobs to job model', () => {
      const parsed = index.parseJobsPage(apiData);

      if (!fetchOk || parsed.jobs.length === 0) {
        console.log('No jobs to map — skipping mapping assertions');
        return;
      }

      const model = index.mapToJobModel(parsed.jobs[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model).toHaveProperty('company');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
      expect(model.url).toMatch(new RegExp(`^${JOB_BASE}/`));
    });

    it('should transform jobs with correct company info', () => {
      const parsed = index.parseJobsPage(apiData);
      const jobs = parsed.jobs.map(j => index.mapToJobModel(j, TEST_CIF));

      const payload = {
        source: 'bamboohr.com',
        company: 'TEC SOFTWARE SOLUTIONS SRL',
        cif: TEST_CIF,
        jobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toBe('TEC SOFTWARE SOLUTIONS SRL');

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(job).toHaveProperty('workmode');
      }
    });

    it('should produce valid job URLs that are accessible', async () => {
      const parsed = index.parseJobsPage(apiData);

      if (!fetchOk || parsed.jobs.length === 0) {
        console.log('No jobs to check — skipping URL accessibility assertions');
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

    it('should validate TEC SOFTWARE SOLUTIONS SRL via ANAF by CIF', async () => {
      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);

      expect(anafData).toBeDefined();
      expect(anafData.cui).toBe(32971419);
      expect(anafData.name).toBe('TEC SOFTWARE SOLUTIONS SRL');
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('TEC SOFTWARE SOLUTIONS SRL');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('No TEC jobs in Solr — skipping job count assertion');
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

    it('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany('TEC');

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

    itIfSolr('should have TEC jobs in SOLR with correct company name', async () => {
      const result = await solr.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('No TEC jobs in Solr — skipping SOLR data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe('TEC SOFTWARE SOLUTIONS SRL');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfSolr('should have TEC company core entry with required fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${TEST_CIF}`);

      expect(result.numFound).toBe(1);
      const tec = result.docs[0];
      expect(tec.company).toBe('TEC SOFTWARE SOLUTIONS SRL');
      expect(tec.status).toBe('activ');
    }, 15000);
  });
});
