<#
.SYNOPSIS
  Serve the built web app over HTTPS on the LAN so a phone can use the mic.

.DESCRIPTION
  Android Chrome only exposes getUserMedia in a secure context, and a private
  address cannot obtain a public certificate. This fronts the plain-HTTP Next
  server with TLS using the leaf from scripts/https-cert.ps1, so the app keeps
  one build and the /api rewrite keeps pointing at the API on 3001.

  Plain HTTP on a LAN address can never work: navigator.mediaDevices is
  undefined there, and clicking through a certificate warning does not make the
  origin secure. The CA has to be installed as a trusted root on the phone.

.EXAMPLE
  .\scripts\https-serve.ps1

.EXAMPLE
  .\scripts\https-serve.ps1 -Port 3443 -Target http://127.0.0.1:3100
#>
[CmdletBinding()]
param(
    [int]$Port = 3443,
    [string]$Target = 'http://127.0.0.1:3100'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'certs'
$leafCert = Join-Path $certDir 'lan.crt'
$leafKey = Join-Path $certDir 'lan.key'

if (-not (Test-Path -LiteralPath $leafCert) -or -not (Test-Path -LiteralPath $leafKey)) {
    throw "No certificate in $certDir. Run scripts/https-cert.ps1 first."
}

$proxy = Join-Path $PSScriptRoot 'https-proxy.mjs'
& node.exe $proxy $Target "$Port" $leafCert $leafKey
