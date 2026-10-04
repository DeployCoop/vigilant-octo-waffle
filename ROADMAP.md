# Roadmap

## Current State

The project provides a local Kubernetes environment with:
- KinD/K3s cluster
- ArgoCD for GitOps deployments
- TLS with mkcert
- Multi-application support (OpenLDAP, Harbor, Nextcloud, OpenProject, etc.)
- Configurable via .env and .env.enabler
- Optional role-based authorization (CASL): named principals with per-principal tokens or OIDC sign-in, scoped grants/revocations, secret redaction, and an audit log — managed in Settings → Access & Audit or via `vow authz` (see ARCHITECTURE.md § Authorization Model)

## Next Steps

### Secrets Management
- Implement OpenBAO integration for secret management
- Update all charts to use secrets instead of values in values files
- Create PRs upstream to chart repositories for secret support

### Authorization Follow-ups
- Audit log rotation / size caps for `.vow/audit.log`
- Kubeconfig-context scoping for grants (deferred from authz v1)
- Optional session cookies as an alternative to localStorage tokens

### Architecture Improvements
- Convert shell scripts to Python where appropriate
- Add more error handling and validation
- Improve logging and status reporting
- Add health checks for all components

### Feature Enhancements
- Add support for K3D as an alternative to KinD
- Improve documentation for production use cases
- Add more application templates (e.g., GitLab, Jenkins)
- Add monitoring and alerting for local cluster

### Development Process
- Add CI/CD pipeline for testing changes
- Add more unit tests for shell scripts
- Improve code formatting and consistency
- Add more examples and tutorials

## Language Considerations

- Currently using Bash for all scripts
- Considering Python for more complex logic
- Open to Rust for performance-critical components

## Style Guide

- Using `${this_var}` syntax for variables
- Using double brackets for tests
- Using double parentheses for arithmetic
- All execution should be at the base of the repo
- All scripts should be in the `src` directory
- Avoid `cd` commands, return to root after operations
