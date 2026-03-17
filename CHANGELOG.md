# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Local web console for importing nodes, managing instances, viewing logs, and running proxy tests.
- Support for importing Mihomo / Clash YAML, inline node definitions, JSON, and mixed multi-section input.
- Instance deletion support in the management UI and backend API.
- Release audit script for checking files that should not be published.
- Open-source project files including `LICENSE`, `CONTRIBUTING.md`, issue templates, and PR template.
- Real management console screenshot for the README.
- GitHub Actions CI workflow for syntax checks, tests, and release audit.

### Changed

- Renamed the project from `sub2api-proxy` to `mihomo-multiport`.
- Refocused project positioning from an upstream-system helper to a general multi-port Mihomo manager.
- Improved bulk operation handling so failed instances no longer abort the entire run.

### Security

- Removed real node data and generated runtime artifacts from the publish-ready project directory.
