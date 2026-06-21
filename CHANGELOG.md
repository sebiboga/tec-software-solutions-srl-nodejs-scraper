# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-21

### Added
- Initial release for TEC SOFTWARE SOLUTIONS SRL
- Job scraping from BambooHR API at https://tecss.bamboohr.com/careers/list
- Company validation via ANAF
- SOLR integration for job storage
- GitHub Actions workflows for daily scraping and testing
- Comprehensive test suite (unit, integration, E2E)
- ANAF API fallback with cached data support
- Node 24 compatibility

### Features
- Automated daily job scraping
- Company core validation and management
- Job URL validation
- Data integrity checks
- Romanian location filtering
- Work mode normalization
- Brand: TEC Agency
- Default location: Cluj-Napoca

## License

Copyright (c) 2024-2026 BOGA SEBASTIAN-NICOLAE
Licensed under MIT License
