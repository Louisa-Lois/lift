# infra/terraform

INF-01: both EC2 instances (IMDSv2 with hop limit 1), security groups, Elastic IPs, Cloudflare records `app` and `*.apps`, and the AWS budget with its stop action. State lives in S3 with `use_lockfile = true` and is never committed; `.gitignore` already excludes state, `.terraform/` and `*.tfvars` (commit a `*.tfvars.example` instead).
