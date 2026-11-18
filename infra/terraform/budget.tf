# $50 a month, emailing at 80% and 100% of actual spend; at $120 actual, AWS Budgets stops both VMs.
# Budgets data lags actual spend by up to a day, so treat these as guardrails, not a hard cap.

resource "aws_budgets_budget" "monthly" {
  name         = "lift-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.alert_emails
    }
  }
}

data "aws_iam_policy_document" "budgets_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# Read during plan, so a wrong policy name fails the plan rather than the apply.
data "aws_iam_policy" "budgets_ssm_actions" {
  arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSBudgetsActions_RolePolicyForResourceAdministrationWithSSM"
}

resource "aws_iam_role" "budget_action" {
  name               = "lift-budget-stop-instances"
  description        = "Lets AWS Budgets stop the Lift VMs"
  assume_role_policy = data.aws_iam_policy_document.budgets_assume.json
}

resource "aws_iam_role_policy_attachment" "budget_action" {
  role       = aws_iam_role.budget_action.name
  policy_arn = data.aws_iam_policy.budgets_ssm_actions.arn
}

resource "aws_budgets_budget_action" "stop_instances" {
  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "RUN_SSM_DOCUMENTS"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action.arn

  action_threshold {
    action_threshold_type  = "ABSOLUTE_VALUE"
    action_threshold_value = var.stop_instances_at_usd
  }

  definition {
    ssm_action_definition {
      action_sub_type = "STOP_EC2_INSTANCES"
      region          = var.region
      instance_ids    = [for vm in aws_instance.vm : vm.id]
    }
  }

  dynamic "subscriber" {
    for_each = toset(var.alert_emails)
    content {
      address           = subscriber.value
      subscription_type = "EMAIL"
    }
  }

  depends_on = [aws_iam_role_policy_attachment.budget_action]
}
