<#
.SYNOPSIS
  Create the local certificate authority and the leaf the LAN proxy serves.

.DESCRIPTION
  Android Chrome exposes the camera and microphone only in a secure context, and
  a private address cannot obtain a public certificate. The workable route is a
  local root CA that is installed once on the phone, plus a leaf that names the
  LAN address.

  Files land in certs/ (gitignored):
    rootCA.key / rootCA.crt  the authority - install rootCA.crt on the phone
    lan.key  / lan.crt      what scripts/https-serve.ps1 serves

  Re-running is safe. The leaf is reissued when the machine's LAN addresses
  change or when it is within a week of expiry. -Force reissues regardless.

.EXAMPLE
  .\scripts\https-cert.ps1

.EXAMPLE
  .\scripts\https-cert.ps1 -IpAddresses 192.168.50.222 -Force
#>
[CmdletBinding()]
param(
    [string[]]$IpAddresses,
    [int]$LeafDays = 825,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Resolve-OpenSSL {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'),
        (Join-Path $env:ProgramFiles 'Git\mingw64\bin\openssl.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $command = Get-Command openssl.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }
    throw 'OpenSSL was not found. Install Git for Windows or put openssl.exe on PATH.'
}

<#
  The address the phone will actually dial. The default route is the interface a
  LAN client can reach; VPN and WSL adapters answer on their own links and would
  only add noise to the certificate.
#>
function Get-LanAddresses {
    $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Where-Object { $_.NextHop -ne '0.0.0.0' } |
        Sort-Object { $_.RouteMetric + $_.InterfaceMetric }

    $seen = [System.Collections.Generic.List[string]]::new()
    foreach ($route in $routes) {
        $addresses = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 `
            -ErrorAction SilentlyContinue
        foreach ($address in $addresses) {
            $ip = $address.IPAddress
            if ($ip -like '127.*' -or $ip -like '169.254.*') { continue }
            if (-not $seen.Contains($ip)) { $seen.Add($ip) }
        }
        if ($seen.Count -gt 0) { break }
    }
    return $seen.ToArray()
}

#
#   Certificate validity must start slightly in the past. A phone that is a few
#   minutes behind this machine would otherwise see notBefore in its own future
#   and reject the certificate, which looks exactly like a broken certificate.
#   One hour absorbs ordinary clock drift without extending anything meaningful.
#
function Get-NotBefore {
    (Get-Date).ToUniversalTime().AddHours(-1).ToString(
        "yyyyMMddHHmmss",
        [System.Globalization.CultureInfo]::InvariantCulture
    ) + "Z"
}

function Invoke-OpenSSL {
    # $args, not a declared parameter: a declared one swallows openssl flags
    # like -out and rejects them as ambiguous PowerShell parameters.
    # Key generation writes progress dots on stderr; holding both streams keeps
    # that noise out of the console but still reports real failures.
    $output = & $script:openssl @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "openssl $($args -join ' ') failed:
$($output -join "
")"
    }
}

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'certs'
$openssl = Resolve-OpenSSL
$script:openssl = $openssl
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

# @() wraps the whole if: a one-element array assigned from an if would
# otherwise unroll into a bare string, and $ips[0] would be its first character.
$ips = @(if ($IpAddresses) { $IpAddresses } else { Get-LanAddresses })
if ($ips.Count -eq 0) {
    throw 'No LAN IPv4 address was found. Pass -IpAddresses 192.168.50.222 explicitly.'
}

# OpenSSL stops reading a subjectAltName list at the first malformed entry, so a
# typo would silently produce a leaf that covers only some of the addresses.
# Validate here instead, where the error can name the offending value.
$ipPattern = '^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$'
foreach ($ip in $ips) {
    if ($ip -notmatch $ipPattern) {
        throw "'$ip' is not a plain IPv4 address. Pass one value per address."
    }
}
if (($ips | Sort-Object -Unique).Count -ne $ips.Count) {
    throw "The address list contains duplicates: $($ips -join ', ')."
}

# 127.0.0.1 and localhost keep curl and a desktop browser on this machine
# working without extra tooling; the phone only ever uses the LAN address.
$sans = @('IP:127.0.0.1', 'DNS:localhost') + ($ips | ForEach-Object { "IP:$_" })
$commonName = "Displayer $($ips[0])"

$caKey = Join-Path $certDir 'rootCA.key'
$caCert = Join-Path $certDir 'rootCA.crt'
$leafKey = Join-Path $certDir 'lan.key'
$leafCert = Join-Path $certDir 'lan.crt'
$leafCsr = Join-Path $certDir 'lan.csr'
$caConfig = Join-Path $certDir 'ca.cnf'
$serialFile = Join-Path $certDir 'rootCA.srl'
$leafConfig = Join-Path $certDir 'leaf.cnf'
$leafExt = Join-Path $certDir 'leaf-ext.cnf'

@"
[req]
prompt = no
distinguished_name = dn
x509_extensions = v3_ca

[dn]
O = Displayer Local
CN = Displayer Local CA

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
"@ | Set-Content -LiteralPath $caConfig -Encoding utf8

@"
[req]
prompt = no
distinguished_name = dn

[dn]
O = Displayer Local
CN = $commonName
"@ | Set-Content -LiteralPath $leafConfig -Encoding utf8

@"
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = $($sans -join ',')
"@ | Set-Content -LiteralPath $leafExt -Encoding utf8

if ($Force -or -not (Test-Path -LiteralPath $caCert)) {
    if (-not (Test-Path -LiteralPath $caKey)) {
        Write-Host "Creating the root CA key ($caKey)" -ForegroundColor Green
        Invoke-OpenSSL genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $caKey
    }
    Write-Host 'Creating the root CA certificate' -ForegroundColor Green
    Invoke-OpenSSL req -x509 -new -key $caKey -sha256 -days 3650 -not_before (Get-NotBefore) `
        -config $caConfig -out $caCert
}

$reissue = $Force -or -not (Test-Path -LiteralPath $leafCert) -or -not (Test-Path -LiteralPath $leafKey)
if (-not $reissue) {
    # `x509 -ext` prints "IP Address:1.2.3.4", not the "IP:1.2.3.4" spelling the
    # configuration uses. Comparing the two directly would miss every address
    # and reissue the leaf on every run.
    $present = ((& $openssl x509 -in $leafCert -noout -ext subjectAltName 2>$null) -join "`n") `
        -replace 'IP Address:', 'IP:'
    foreach ($san in $sans) {
        if ($present -notmatch [regex]::Escape($san)) {
            Write-Host "The leaf does not cover $san; reissuing." -ForegroundColor Yellow
            $reissue = $true
            break
        }
    }
}
if (-not $reissue) {
    & $openssl x509 -in $leafCert -noout -checkend 604800 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'The leaf expires within a week; reissuing.' -ForegroundColor Yellow
        $reissue = $true
    }
}

if ($reissue) {
    if (-not (Test-Path -LiteralPath $leafKey)) {
        Invoke-OpenSSL genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $leafKey
    }
    Invoke-OpenSSL req -new -key $leafKey -config $leafConfig -out $leafCsr
    Invoke-OpenSSL x509 -req -in $leafCsr -CA $caCert -CAkey $caKey -CAserial $serialFile `
        -not_before (Get-NotBefore) -days $LeafDays -sha256 -extfile $leafExt -out $leafCert
    [System.IO.File]::Delete($leafCsr)
}

Invoke-OpenSSL verify -CAfile $caCert $leafCert | Out-Null

Write-Host ''
Write-Host 'certificates ready' -ForegroundColor Green
Write-Host "  CA      : $caCert"
Write-Host "  leaf    : $leafCert"
Write-Host "  covers  : $($sans -join ', ')"
Write-Host ''
Write-Host 'Install the CA once on the phone (Chrome trusts user-added roots), then'
Write-Host 'serve the app with scripts/https-serve.ps1.'