import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs, upsertCompany } from "./solr.js";
import { generateJobsMarkdown } from "./src/markdown-generator.js";
import companyConfig from "./config/company.js";

const COMPANY_CIF = companyConfig.cif;
const BAMBOO_API_URL = "https://tecss.bamboohr.com/careers/list";
const JOB_BASE = "https://tecss.bamboohr.com/careers";

const TIMEOUT = 10000;

let COMPANY_NAME = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJobsPage() {
  const res = await fetch(BAMBOO_API_URL, {
    timeout: TIMEOUT,
    headers: {
      "User-Agent": "job_seeker_ro_spider",
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`BambooHR API error ${res.status}`);
  }

  const data = await res.json();
  return data;
}

function parseJobsPage(jsonData) {
  const result = jsonData.result || [];
  const total = jsonData.meta?.totalCount || 0;

  return {
    jobs: result.map(job => {
      const location = [];
      if (job.location?.city) location.push(job.location.city);
      if (job.location?.state) location.push(job.location.state);

      const url = `${JOB_BASE}/${job.id}`;

      return {
        url,
        title: job.jobOpeningName,
        uid: String(job.id),
        workmode: "on-site",
        location,
        tags: []
      };
    }),
    total
  };
}

async function scrapeAllListings(testOnlyOnePage = false) {
  console.log("Fetching BambooHR jobs...");
  const data = await fetchJobsPage();
  const result = parseJobsPage(data);
  const jobs = result.jobs;
  console.log(`Total jobs on BambooHR: ${result.total}`);
  console.log(`Fetched ${jobs.length} jobs`);
  return jobs;
}

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

function transformJobsForSOLR(payload) {
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
      return {
        ...job,
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

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
    console.log(`Jobs scraped from BambooHR: ${scrapedCount}`);

    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "bamboohr.com",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);

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

    console.log("\n=== Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    const finalResult = await querySOLR(COMPANY_CIF);
    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`Jobs scraped from BambooHR: ${scrapedCount}`);
    console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { fetchJobsPage, parseJobsPage, mapToJobModel, transformJobsForSOLR };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
