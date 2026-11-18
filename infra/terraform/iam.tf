# ── Instance profiles: SSM only ───────────────────────────────────────────────────────────────
# Each VM can register with Systems Manager (Session Manager shells, Run Command deploys) and
# nothing else. INF-15 adds S3 write for the control plane's nightly pg_dump.

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vm" {
  for_each = local.vms

  name               = "lift-${each.key}-vm"
  description        = "Lift ${each.key} VM: Systems Manager agent"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "vm_ssm" {
  for_each = local.vms

  role       = aws_iam_role.vm[each.key].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "vm" {
  for_each = local.vms

  name = "lift-${each.key}-vm"
  role = aws_iam_role.vm[each.key].name
}

# ── GitHub Actions deploy role ────────────────────────────────────────────────────────────────
# The deploy workflow assumes this role through GitHub's OIDC tokens (no AWS keys in GitHub). It
# can run shell commands through SSM on the two Lift VMs and read the results; nothing else.

locals {
  github_oidc_url = "https://token.actions.githubusercontent.com"
  github_oidc_arn = (
    var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = local.github_oidc_url
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = local.github_oidc_url
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only jobs that run in this repo's deploy environment. Restrict that environment to the main
    # branch in the repo settings; otherwise any branch could use it.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "lift-github-deploy"
  description          = "GitHub Actions deploy: SSM Run Command on the two Lift VMs only"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  # SendCommand is authorised against every resource in the request: the target instances and the
  # document. Listing only these two instances and AWS-RunShellScript is what confines the role.
  statement {
    sid     = "RunShellOnLiftVMsOnly"
    actions = ["ssm:SendCommand"]
    resources = concat(
      [for vm in aws_instance.vm : vm.arn],
      ["arn:${data.aws_partition.current.partition}:ssm:${var.region}::document/AWS-RunShellScript"],
    )
  }

  # Reading command status and output. These actions do not support resource-level permissions,
  # and they cannot start or change anything.
  statement {
    sid       = "ReadCommandResults"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "ssm-run-command-on-lift-vms"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
