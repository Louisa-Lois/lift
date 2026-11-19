terraform {
  # 1.11 is the first release where S3 native locking (use_lockfile) is generally available.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }

  # The bucket (and the AWS profile, if not `lift`) come from backend.hcl at init time:
  #   terraform init -backend-config=backend.hcl
  # State is never committed. S3 native lock files replace the old DynamoDB lock table.
  backend "s3" {
    key          = "lift/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "lift"
      ManagedBy = "terraform"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment, so the token never appears in a variable,
# a tfvars file or the plan. It needs Zone:Read and DNS:Edit on the one zone.
provider "cloudflare" {}
