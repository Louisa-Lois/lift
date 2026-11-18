output "app_url" {
  description = "The dashboard."
  value       = "https://app.${var.domain}"
}

output "apps_url_pattern" {
  description = "Where deployed apps answer."
  value       = "https://{service}-{project}.apps.${var.domain}"
}

output "public_ips" {
  description = "Elastic IPs (DNS points app and *.apps here)."
  value       = { for k, eip in aws_eip.vm : k => eip.public_ip }
}

output "private_ips" {
  description = "Fixed private IPs; the worker reaches the control plane's API (4000) and Redis (6379) at the control one."
  value       = { for k, vm in aws_instance.vm : k => vm.private_ip }
}

output "instance_ids" {
  description = "EC2 instance IDs."
  value       = { for k, vm in aws_instance.vm : k => vm.id }
}

output "shell" {
  description = "Open a root-capable shell on each VM through SSM Session Manager (needs the session-manager-plugin)."
  value = {
    for k, vm in aws_instance.vm :
    k => "aws ssm start-session --profile ${var.aws_profile} --region ${var.region} --target ${vm.id}"
  }
}

output "github_deploy_role_arn" {
  description = "Role the deploy workflow assumes through GitHub OIDC."
  value       = aws_iam_role.github_deploy.arn
}

output "github_actions_variables" {
  description = "Repository variables (not secrets) that .github/workflows/deploy.yml reads. Set them with the commands in github_variable_commands."
  value = {
    AWS_DEPLOY_ROLE_ARN      = aws_iam_role.github_deploy.arn
    AWS_REGION               = var.region
    LIFT_DOMAIN              = var.domain
    LIFT_CONTROL_INSTANCE_ID = aws_instance.vm["control"].id
    LIFT_WORKER_INSTANCE_ID  = aws_instance.vm["worker"].id
  }
}

output "github_variable_commands" {
  description = "Run these from the repo to set the deploy workflow's variables."
  value = join("\n", [
    for name, value in {
      AWS_DEPLOY_ROLE_ARN      = aws_iam_role.github_deploy.arn
      AWS_REGION               = var.region
      LIFT_DOMAIN              = var.domain
      LIFT_CONTROL_INSTANCE_ID = aws_instance.vm["control"].id
      LIFT_WORKER_INSTANCE_ID  = aws_instance.vm["worker"].id
    } : "gh variable set ${name} --repo ${var.github_repository} --body '${value}'"
  ])
}
