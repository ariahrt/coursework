# Deploys the site to cnv.byhrt.com.
# Uploads site/ and server/ to the server, then runs a setup script there
# (server/remote-setup.sh unless -Setup names another one in server/).
# You'll be asked for your SSH password twice (upload, then setup) and your sudo password once.
#
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -User <your ssh username>

param(
  [string]$User = $(Read-Host "SSH username for byhrt.com"),
  [string]$Server = "byhrt.com",
  [string]$Setup = "remote-setup.sh"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$target = "$User@$Server"

Write-Host "==> Uploading files to $target"
# cmd does the pipe so the tar stream stays binary (PowerShell 5 would mangle it).
$unpack = 'rm -rf ~/cnv-deploy && mkdir -p ~/cnv-deploy && tar -xzf - -C ~/cnv-deploy'
cmd /c "tar -czf - site server | ssh $target `"$unpack`""
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

Write-Host "==> Running setup on the server"
ssh -t $target "sed -i 's/\r$//' ~/cnv-deploy/server/$Setup && bash ~/cnv-deploy/server/$Setup"
if ($LASTEXITCODE -ne 0) { throw "Setup failed. See the messages above." }
