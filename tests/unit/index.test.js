import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

describe('index.js Component Tests', () => {
  let index;

  beforeAll(async () => {
    index = await import('../../index.js');
  });

  describe('fetchJobsPage', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('should fetch data from BambooHR API and return JSON', async () => {
      const mockData = {
        result: [{ id: 1, jobOpeningName: 'Test' }],
        meta: { totalCount: 1 }
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockData
      });

      const result = await index.fetchJobsPage();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://tecss.bamboohr.com/careers/list',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'job_seeker_ro_spider'
          })
        })
      );
      expect(result).toEqual(mockData);
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(index.fetchJobsPage()).rejects.toThrow('BambooHR API error 500');
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(index.fetchJobsPage()).rejects.toThrow('Network error');
    });
  });

  describe('parseJobsPage', () => {
    it('should parse BambooHR API response format', () => {
      const apiData = {
        result: [
          {
            id: 40,
            jobOpeningName: 'Full Stack Developer',
            departmentLabel: 'Engineering',
            location: { city: 'Cluj-Napoca', state: '', country: { name: 'Romania' } },
            employmentStatusLabel: 'Full-Time',
            publishedDate: '2025-01-15T00:00:00.000Z'
          }
        ],
        meta: { totalCount: 1 }
      };

      const result = index.parseJobsPage(apiData);

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe('Full Stack Developer');
      expect(result.jobs[0].location).toEqual(['Cluj-Napoca']);
      expect(result.jobs[0].url).toBe('https://tecss.bamboohr.com/careers/40');
      expect(result.jobs[0].uid).toBe('40');
      expect(result.total).toBe(1);
    });

    it('should handle empty job list', () => {
      const apiData = { result: [], meta: { totalCount: 0 } };

      const result = index.parseJobsPage(apiData);

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle missing result field', () => {
      const result = index.parseJobsPage({});

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should include state in location when present', () => {
      const apiData = {
        result: [
          {
            id: 45,
            jobOpeningName: 'Developer',
            location: { city: 'Bucharest', state: 'București', country: { name: 'Romania' } }
          }
        ],
        meta: { totalCount: 1 }
      };

      const result = index.parseJobsPage(apiData);
      expect(result.jobs[0].location).toEqual(['Bucharest', 'București']);
    });

    it('should default to on-site workmode', () => {
      const apiData = {
        result: [
          {
            id: 50,
            jobOpeningName: 'Developer',
            location: { city: 'Cluj-Napoca', state: '', country: { name: 'Romania' } }
          }
        ],
        meta: { totalCount: 1 }
      };

      const result = index.parseJobsPage(apiData);
      expect(result.jobs[0].workmode).toBe('on-site');
    });
  });

  describe('mapToJobModel', () => {
    it('should map raw job to job model format', () => {
      const rawJob = {
        url: 'https://tecss.bamboohr.com/careers/40',
        title: 'Full Stack Developer',
        location: ['Cluj-Napoca'],
        tags: ['JavaScript'],
        workmode: 'on-site'
      };

      const COMPANY_NAME = 'TEC SOFTWARE SOLUTIONS SRL';
      const COMPANY_CIF = '32971419';

      const result = index.mapToJobModel(rawJob, COMPANY_CIF, COMPANY_NAME);

      expect(result.url).toBe(rawJob.url);
      expect(result.title).toBe(rawJob.title);
      expect(result.company).toBe(COMPANY_NAME);
      expect(result.cif).toBe(COMPANY_CIF);
      expect(result.location).toEqual(rawJob.location);
      expect(result.tags).toEqual(rawJob.tags);
      expect(result.workmode).toBe(rawJob.workmode);
      expect(result.status).toBe('scraped');
      expect(result.date).toBeDefined();
    });

    it('should remove undefined fields', () => {
      const rawJob = {
        url: 'https://tecss.bamboohr.com/careers/1',
        title: 'Job 1'
      };

      const result = index.mapToJobModel(rawJob, '32971419');

      expect(result.location).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.workmode).toBeUndefined();
    });

    it('should handle missing title', () => {
      const rawJob = { url: 'https://tecss.bamboohr.com/careers/1' };

      const result = index.mapToJobModel(rawJob, '32971419');

      expect(result.title).toBeUndefined();
      expect(result.url).toBe('https://tecss.bamboohr.com/careers/1');
    });
  });

  describe('transformJobsForSOLR', () => {
    it('should keep company uppercase', () => {
      const payload = {
        source: 'bamboohr.com',
        company: 'tec software solutions srl',
        cif: '32971419',
        jobs: [
          { url: 'https://tecss.bamboohr.com/careers/1', title: 'Job 1' }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.company).toBe('TEC SOFTWARE SOLUTIONS SRL');
    });

    it('should normalize workmode values', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', workmode: 'Remote' },
          { url: 'https://test.com/2', title: 'Job 2', workmode: 'ON-SITE' },
          { url: 'https://test.com/3', title: 'Job 3', workmode: 'Hybrid' },
          { url: 'https://test.com/4', title: 'Job 4', workmode: 'hybrid' }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.jobs[0].workmode).toBe('remote');
      expect(result.jobs[1].workmode).toBe('on-site');
      expect(result.jobs[2].workmode).toBe('hybrid');
      expect(result.jobs[3].workmode).toBe('hybrid');
    });

    it('should handle empty jobs array', () => {
      const result = index.transformJobsForSOLR({ jobs: [] });
      expect(result.jobs).toEqual([]);
    });

    it('should pass through location unchanged', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', location: ['Cluj-Napoca'] }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.jobs[0].location).toEqual(['Cluj-Napoca']);
    });
  });
});
