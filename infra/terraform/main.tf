# Two VMs in one default subnet: the control plane (app.{domain}) and the worker (*.apps.{domain}).
# Nothing listens on port 22: shell access and platform deploys both go through AWS Systems Manager.

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "default" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = local.availability_zone
  default_for_az    = true
}

# Ubuntu 24.04 LTS from Canonical. Only read when an instance is created: see ignore_changes below.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

locals {
  availability_zone = var.availability_zone != "" ? var.availability_zone : "${var.region}a"

  # Fixed private addresses, so a replaced control plane keeps the address the worker's config
  # (and INF-11's firewall rules) point at. .1 to .3 of every subnet are reserved by AWS.
  control_private_ip = cidrhost(data.aws_subnet.default.cidr_block, 10)
  worker_private_ip  = cidrhost(data.aws_subnet.default.cidr_block, 11)

  vms = {
    control = {
      instance_type = var.control_instance_type
      disk_gb       = 30
      private_ip    = local.control_private_ip
    }
    worker = {
      instance_type = var.worker_instance_type
      disk_gb       = 80
      private_ip    = local.worker_private_ip
    }
  }
}

# ── Security groups ────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "vm" {
  for_each = local.vms

  name        = "lift-${each.key}"
  description = "Lift ${each.key} VM: HTTP and HTTPS in, no SSH"
  vpc_id      = data.aws_vpc.default.id

  tags = { Name = "lift-${each.key}" }
}

# 80 for the HTTP-to-HTTPS redirect, 443 for everything else. Certificates come by DNS-01, so
# port 80 is not needed for ACME.
resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = {
    for pair in setproduct(keys(local.vms), [80, 443]) : "${pair[0]}-${pair[1]}" => { vm = pair[0], port = pair[1] }
  }

  security_group_id = aws_security_group.vm[each.value.vm].id
  description       = "HTTP and HTTPS from anywhere"
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = "0.0.0.0/0"
}

# The worker reaches the control plane's internal API (4000) and Redis (6379) over the private
# network. The security group is what keeps these ports off the internet: Docker binds them to the
# private IP, which is also where Elastic IP traffic arrives.
resource "aws_vpc_security_group_ingress_rule" "control_from_worker" {
  for_each = { api = 4000, redis = 6379 }

  security_group_id            = aws_security_group.vm["control"].id
  description                  = "${each.key} from the worker"
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = aws_security_group.vm["worker"].id
}

# Outbound: package updates, image pulls, GitHub, Let's Encrypt, Cloudflare, Anthropic and the
# SSM endpoints. INF-11 narrows what app containers can reach with iptables on the host.
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = local.vms

  security_group_id = aws_security_group.vm[each.key].id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ── Instances ─────────────────────────────────────────────────────────────────────────────────

resource "aws_instance" "vm" {
  for_each = local.vms

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = each.value.instance_type
  subnet_id              = data.aws_subnet.default.id
  private_ip             = each.value.private_ip
  vpc_security_group_ids = [aws_security_group.vm[each.key].id]
  iam_instance_profile   = aws_iam_instance_profile.vm[each.key].name
  # No key_name: there is no SSH key pair. Shell access is `aws ssm start-session`.

  # Non-secret facts only (role, domain, private IPs). Secrets go in /opt/lift/.env by hand.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    role               = each.key
    domain             = var.domain
    private_ip         = each.value.private_ip
    control_private_ip = local.control_private_ip
  })

  # Apps on the worker must never reach the instance's credentials: IMDSv2 only, and a hop limit
  # of 1 so the token response cannot cross the extra hop into a container.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = each.value.disk_gb
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = "lift-${each.key}-root" }
  }

  tags = {
    Name = "lift-${each.key}"
    Role = each.key
  }

  lifecycle {
    # A newer Ubuntu AMI must not replace a running VM; unattended upgrades patch it in place.
    # cloud-init runs once per instance, so editing user_data cannot change a running VM either:
    # to apply a new cloud-init, replace the VM with `terraform apply -replace='aws_instance.vm["worker"]'`.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "vm" {
  for_each = local.vms

  domain = "vpc"
  tags   = { Name = "lift-${each.key}" }
}

resource "aws_eip_association" "vm" {
  for_each = local.vms

  allocation_id = aws_eip.vm[each.key].id
  instance_id   = aws_instance.vm[each.key].id
}
