# infra/terraform

INF-01: the two EC2 instances (IMDSv2 with hop limit 1, SSM-only instance profiles, no SSH), security groups, Elastic IPs, Cloudflare records `app` and `*.apps`, the AWS budget with its stop action, and the GitHub OIDC role the deploy workflow uses to run SSM commands on the two VMs. Design: [docs/prd/04-infrastructure.md](../../docs/prd/04-infrastructure.md).

| File | What it holds |
| --- | --- |
| `versions.tf` | Terraform and provider versions, the S3 backend, provider settings |
| `variables.tf` · `terraform.tfvars.example` | Inputs; copy the example to `terraform.tfvars` (git-ignored) |
| `main.tf` | Default VPC and subnet, security groups, the two instances, Elastic IPs |
| `cloud-init.yaml.tftpl` | First-boot setup: Docker, SSM agent, `/opt/lift`, `lift.service` |
| `iam.tf` | Instance profiles (SSM only) and the GitHub deploy role |
| `dns.tf` | Cloudflare `app` and `*.apps` records, DNS only |
| `budget.tf` | $50 monthly budget, emails at 80% and 100%, stop both VMs at $120 |
| `outputs.tf` | IPs, URLs, SSM session commands, the deploy workflow's GitHub variables |

## Before the first run

- Terraform 1.11 or newer and the AWS CLI with the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).
- AWS profile `lift` for the account, region `eu-west-1`.
- A Cloudflare API token with **Zone → Zone → Read** and **Zone → DNS → Edit** on the one zone, exported as `CLOUDFLARE_API_TOKEN` (for example from `~/.config/lift/terraform.env`). It never goes in a file here.
- `backend.hcl` (from `backend.hcl.example`) naming the state bucket, and `terraform.tfvars` (from the example).

## Commands

```bash
cd infra/terraform
source ~/.config/lift/terraform.env      # exports CLOUDFLARE_API_TOKEN
export AWS_PROFILE=lift
terraform init -backend-config=backend.hcl
terraform fmt -check && terraform validate
terraform plan -out=lift.tfplan          # review it
terraform apply lift.tfplan              # the WS4 owner applies; never from CI
terraform output -raw github_variable_commands  # then run the printed gh commands
```

State lives in S3 with `use_lockfile = true` and is never committed; `.gitignore` excludes state, `.terraform/`, `terraform.tfvars`, `backend.hcl` and `*.tfplan`. Commit `.terraform.lock.hcl`.

## Things to know

- **No SSH.** Open a shell with the command in `terraform output shell`. Deploys use SSM Run Command through the `lift-github-deploy` role, which can only target these two instances with `AWS-RunShellScript`.
- **Replacing a VM.** Neither a new Ubuntu AMI nor a change to `cloud-init.yaml.tftpl` touches a running VM. To rebuild one: `terraform apply -replace='aws_instance.vm["worker"]'`, then recreate its `/opt/lift/.env` and redeploy. The private IPs are fixed, so the other VM needs no change.
- **Demo week.** Set `worker_instance_type = "t3.xlarge"` and apply; AWS stops and starts the worker, and the Elastic IP keeps its address.
- **Who can deploy.** The deploy role trusts one OIDC subject: `{github_oidc_sub_prefix}:{github_deploy_context}`, today `repo:Louisa-Lois@231678881/lift@1460281207:ref:refs/heads/main`. The owner and repo IDs pin this exact repo. Anyone who can push to `main` can deploy, so protect `main` (pull requests only). To require a `production` environment instead, restrict that environment to `main`, set `github_deploy_context = "environment:production"`, apply, and add `environment: production` to the deploy job in the same change.
- **GitHub OIDC provider.** An account can hold only one for `token.actions.githubusercontent.com`. If the plan fails because it exists, set `create_github_oidc_provider = false`.
