# DNS only (grey cloud), not proxied: Traefik on each VM terminates TLS with its own Let's Encrypt
# certificates, and WebSockets and SSE go straight to it.

data "cloudflare_zone" "this" {
  filter = {
    name = var.domain
  }
}

resource "cloudflare_dns_record" "app" {
  zone_id = data.cloudflare_zone.this.zone_id
  name    = "app.${var.domain}"
  type    = "A"
  content = aws_eip.vm["control"].public_ip
  ttl     = 300
  proxied = false
  comment = "Lift control plane (Terraform, infra/terraform)"
}

resource "cloudflare_dns_record" "apps_wildcard" {
  zone_id = data.cloudflare_zone.this.zone_id
  name    = "*.apps.${var.domain}"
  type    = "A"
  content = aws_eip.vm["worker"].public_ip
  ttl     = 300
  proxied = false
  comment = "Lift worker: every deployed app (Terraform, infra/terraform)"
}
