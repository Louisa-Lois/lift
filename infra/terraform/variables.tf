variable "domain" {
  description = "Apex domain on Cloudflare, e.g. example.dev. The dashboard is app.{domain}; apps are *.apps.{domain}."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.domain)) && !startswith(var.domain, "app.")
    error_message = "Use the bare zone name in lowercase, such as example.dev."
  }
}

variable "region" {
  description = "AWS region for both VMs."
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile Terraform runs as. CI never runs Terraform."
  type        = string
  default     = "lift"
}

variable "availability_zone" {
  description = "AZ for both VMs; they share one default subnet so they talk over private IPs. Empty means {region}a."
  type        = string
  default     = ""
}

variable "control_instance_type" {
  description = "Control plane size."
  type        = string
  default     = "t3.medium"
}

variable "worker_instance_type" {
  description = "Worker size: t3.large normally, t3.xlarge in demo week. Changing it stops and starts the VM; the Elastic IP keeps the address."
  type        = string
  default     = "t3.large"
}

variable "alert_emails" {
  description = "Who gets the budget emails."
  type        = list(string)

  validation {
    condition     = length(var.alert_emails) > 0 && alltrue([for e in var.alert_emails : can(regex("^[^@\\s]+@[^@\\s]+$", e))])
    error_message = "Give at least one email address."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly budget; emails go out at 80% and 100% of it."
  type        = number
  default     = 50
}

variable "stop_instances_at_usd" {
  description = "Actual monthly spend at which an AWS Budgets action stops both VMs."
  type        = number
  default     = 120
}

variable "github_repository" {
  description = "owner/name of the GitHub repo whose deploy workflow may run SSM commands, with the exact case GitHub uses (e.g. Louisa-Lois/lift)."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "Use owner/name."
  }
}

variable "github_oidc_sub_prefix" {
  description = "The repo part of the `sub` claim in this repo's GitHub OIDC tokens, exactly as GitHub reports it: gh api repos/OWNER/NAME/actions/oidc/customization/sub --jq .sub_claim_prefix. Repos with immutable subjects (the default since July 2026) use repo:OWNER@OWNER_ID/NAME@REPO_ID, which keeps trusting this repo even if a repo with the same name is created later."
  type        = string

  validation {
    condition     = startswith(var.github_oidc_sub_prefix, "repo:") && replace(var.github_oidc_sub_prefix, "/@[0-9]+/", "") == "repo:${var.github_repository}"
    error_message = "Use the sub_claim_prefix GitHub reports for github_repository, e.g. repo:Louisa-Lois@231678881/lift@1460281207."
  }
}

variable "github_deploy_context" {
  description = "The rest of the `sub` claim the deploy role trusts: ref:refs/heads/main while the repo can't use environments (private under GitHub Free), or environment:production once it can (public, or the owner on Pro or Team) and that environment is restricted to main."
  type        = string
  default     = "ref:refs/heads/main"

  validation {
    condition     = can(regex("^(ref:refs/heads/[^*?:]+|environment:[^*?:]+)$", var.github_deploy_context))
    error_message = "Use ref:refs/heads/BRANCH or environment:NAME, with no wildcards."
  }
}

variable "create_github_oidc_provider" {
  description = "An AWS account holds one GitHub OIDC provider. Set false if the account already has token.actions.githubusercontent.com."
  type        = bool
  default     = true
}
