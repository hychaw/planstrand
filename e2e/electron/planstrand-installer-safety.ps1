# Real NSIS regression. Never targets a checkout. Refuses to touch an existing
# installation; creates only disposable test content and a temporary default install.
param(
  [string]$Installer = '.tmp/app-builds/Planstrand-Setup.exe',
  # For hosts where Device Guard blocks unsigned app launch. CI never uses this.
  [switch]$InstallerOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'planstrand-installer-ui.ps1')
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$guid = 'f742ac0b-6794-588a-a5f8-d13e36ad8eb9'
$installKey = "HKCU:\Software\$guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$destination = Join-Path $env:LOCALAPPDATA 'Programs\Planstrand'
$exe = Join-Path $destination 'Planstrand.exe'
$uninstaller = Join-Path $destination 'Uninstall Planstrand.exe'
$profile = Join-Path $env:APPDATA 'Planstrand'
$root = Join-Path ([IO.Path]::GetTempPath()) ('Planstrand-safety-' + [guid]::NewGuid())
$unsafe = Join-Path $root 'unrelated Planstrand files'
$sentinel = Join-Path $unsafe 'DO-NOT-DELETE.txt'
$nested = Join-Path $unsafe 'nested\keep.txt'
$profileSentinel = Join-Path $profile ('installer-safety-' + [guid]::NewGuid() + '.txt')
function Assert-True($Condition, $Message) {
  if (!$Condition) { throw $Message }
}
function Run-Installer($File, $Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (!$process.WaitForExit(120000)) { throw "Timed out: $File" }
  return $process.ExitCode
}
function Assert-Sentinels {
  Assert-True ((Get-Content -LiteralPath $sentinel -Raw) -eq 'unrelated') 'Root sentinel changed/deleted'
  Assert-True ((Get-Content -LiteralPath $nested -Raw) -eq 'nested unrelated') 'Nested sentinel changed/deleted'
  Assert-True (!(Test-Path -LiteralPath (Join-Path $unsafe 'Planstrand.exe'))) 'Installer claimed unsafe target'
}
Assert-True (!(Test-Path -LiteralPath $destination)) "Existing default directory: $destination; use a clean Windows test host"
Assert-True (!(Test-Path -LiteralPath $installKey)) 'Existing Planstrand registration; use a clean Windows test host'
Assert-True (!(Test-Path -LiteralPath $uninstallKey)) 'Existing Planstrand uninstall entry; use a clean Windows test host'
New-Item -ItemType Directory -Path (Split-Path $nested) -Force | Out-Null
[IO.File]::WriteAllText($sentinel, 'unrelated')
[IO.File]::WriteAllText($nested, 'nested unrelated')
foreach ($switch in @('/D=', '/d=')) {
  # /D must be last and unquoted, including spaces (NSIS native syntax).
  Assert-True ((Run-Installer $Installer "/S /currentuser $switch$unsafe") -eq 2) 'Unsafe /D target was not rejected'
  Assert-Sentinels
  Assert-True (!(Test-Path -LiteralPath $exe)) 'Rejected install created app files'
}
# A previous unsafe RC registration must not trigger its recursive uninstaller.
New-Item -Path $installKey -Force | Out-Null
New-ItemProperty -Path $installKey -Name InstallLocation -Value $unsafe | Out-Null
try {
  Assert-True ((Run-Installer $Installer '/S /currentuser') -eq 2) 'Unsafe prior registration accepted'
  Assert-Sentinels
} finally { Remove-Item -LiteralPath $installKey }
# Even the dedicated default must not claim unrelated pre-existing content.
New-Item -ItemType Directory -Path $destination | Out-Null
$defaultSentinel = Join-Path $destination 'DO-NOT-DELETE.txt'
[IO.File]::WriteAllText($defaultSentinel, 'default unrelated')
Assert-True ((Run-Installer $Installer '/S /currentuser') -eq 2) 'Non-empty unowned default was not rejected'
Assert-True ((Get-Content -LiteralPath $defaultSentinel -Raw) -eq 'default unrelated') 'Default sentinel removed'
Remove-Item -LiteralPath $defaultSentinel
# Nonrecursive: this fails if the rejected installer wrote anything else.
[IO.Directory]::Delete($destination)
Assert-True ((Run-Installer $Installer '/S /currentuser') -eq 0) 'Default installation failed'
Assert-True (Test-Path -LiteralPath $exe) 'Default executable missing'
Assert-True ((Get-Item -LiteralPath $exe).VersionInfo.ProductName -eq 'Planstrand') 'Wrong executable product name'
Assert-True ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -match '^19\.1\.0') 'Wrong technical version'
$metadata = Get-ItemProperty -LiteralPath $uninstallKey
Assert-True ($metadata.DisplayName -eq 'Planstrand') 'Wrong uninstall display name'
Assert-True ((Get-ItemProperty -LiteralPath $installKey).InstallLocation -eq $destination) 'Wrong dedicated install location'
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Planstrand.lnk'
Assert-True (Test-Path -LiteralPath $shortcut) 'Planstrand Start Menu shortcut missing'
$shell = New-Object -ComObject WScript.Shell
Assert-True ($shell.CreateShortcut($shortcut).TargetPath -eq $exe) 'Wrong shortcut target'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
[IO.File]::WriteAllText($profileSentinel, 'retain profile')
# Launch installed application and verify profile isolation in the real runtime.
if (!$InstallerOnly) {
node -e 'const { _electron } = require("@playwright/test"); (async () => { const app = await _electron.launch({executablePath: process.argv[1], args: ["--disable-gpu"]}); try { const page = await app.firstWindow(); await page.locator("planstrand-page").waitFor({timeout:60000}); const identity = await app.evaluate(({app}) => ({name:app.getName(), profile:app.getPath("userData")})); if(identity.name !== "Planstrand" || identity.profile !== process.argv[2]) throw Error(JSON.stringify(identity)); } finally { await app.close(); } })().catch(e => {console.error(e);process.exit(1)});' $exe $profile
Assert-True ($LASTEXITCODE -eq 0) 'Installed launch/profile check failed'
# The existing full packaged flow also exercises imports, export and persistence.
node e2e/electron/planstrand-rc-smoke.cjs $exe
Assert-True ($LASTEXITCODE -eq 0) 'Installed packaged smoke failed'
}
# A hardened installation can be reinstalled/upgraded safely.
Assert-True ((Run-Installer $Installer '/S /currentuser') -eq 0) 'Hardened reinstall failed'
# _?= is NSIS's native uninstall destination override. Copy the uninstaller to
# our temp root to avoid its asynchronous self-relaunch and observe the real exit.
$testUninstaller = Join-Path $root 'test-uninstall.exe'
Copy-Item -LiteralPath $uninstaller -Destination $testUninstaller
$overrideExit = Run-Installer $testUninstaller "/S /currentuser _?=$unsafe"
Assert-True ($overrideExit -in @(0, 2)) 'Unsafe uninstall attempt failed unexpectedly'
Assert-Sentinels
# initMultiUser may ignore _?= and resolve the registered dedicated directory.
# Either refusal or removal of that recognized installation is safe.
if ($overrideExit -eq 2) {
  Assert-True (Test-Path -LiteralPath $exe) 'Rejected uninstall removed app'
} else {
  Assert-True (!(Test-Path -LiteralPath $exe)) 'Override uninstall did not remove only the registered app'
  Assert-True ((Get-Content -LiteralPath $profileSentinel -Raw) -eq 'retain profile') 'Override uninstall deleted profile'
  Assert-True ((Run-Installer $Installer '/S /currentuser') -eq 0) 'Reinstall after safe override uninstall failed'
}
# _?= keeps uninstall in-process and deterministic; only the verified default is used.
Assert-True ((Run-Installer $uninstaller "/S /currentuser _?=$destination") -eq 0) 'Uninstall failed'
Assert-True (!(Test-Path -LiteralPath $exe)) 'Uninstall retained application executable'
Assert-True (!(Test-Path -LiteralPath (Join-Path $destination 'resources\app.asar'))) 'Uninstall retained application archive'
Assert-True (!(Test-Path -LiteralPath $shortcut)) 'Uninstall retained Start Menu shortcut'
Assert-True (!(Test-Path -LiteralPath $uninstallKey)) 'Uninstall retained registration'
Assert-True ((Get-Content -LiteralPath $profileSentinel -Raw) -eq 'retain profile') 'Uninstall deleted profile'
Assert-Sentinels
Remove-Item -LiteralPath $profileSentinel
# _?= prevents the running uninstaller deleting itself. Remove that exact file
# after proving app removal; nonrecursive deletion proves nothing else remains.
if (Test-Path -LiteralPath $uninstaller) { Remove-Item -LiteralPath $uninstaller }
if (Test-Path -LiteralPath $destination) { [IO.Directory]::Delete($destination) }

# The same policy must run after the actual destination page, not just for /D=.
Assert-True ((Invoke-PlanstrandInstallerUI $Installer $unsafe) -eq 2) 'Unsafe UI destination accepted'
Assert-Sentinels
$destination = Join-Path $root 'CustomApps\Planstrand'
$exe = Join-Path $destination 'Planstrand.exe'
$uninstaller = Join-Path $destination 'Uninstall Planstrand.exe'
Assert-True ((Invoke-PlanstrandInstallerUI $Installer $destination) -eq 0) 'Safe custom UI installation failed'
Assert-True (Test-Path -LiteralPath $exe) 'Custom installation executable missing'
$metadata = Get-ItemProperty -LiteralPath $uninstallKey
Assert-True ($metadata.DisplayName -eq 'Planstrand') 'Custom Installed Apps name is wrong'
Assert-True ($metadata.UninstallString -eq ('"' + $uninstaller + '" /currentuser')) 'Custom uninstall command is invalid'
Assert-True ((Get-ItemProperty -LiteralPath $installKey).InstallLocation -eq $destination) 'Custom registration location mismatch'
if (!$InstallerOnly) {
  node e2e/electron/planstrand-rc-smoke.cjs $exe
  Assert-True ($LASTEXITCODE -eq 0) 'Custom installed application smoke failed'
}
Assert-True ((Run-Installer $Installer "/S /currentuser /D=$destination") -eq 0) 'Owned custom upgrade failed'
# A marker plus registration does not allow arbitrary files or a repository.
$mixedSentinel = Join-Path $destination 'DO-NOT-DELETE.txt'
[IO.File]::WriteAllText($mixedSentinel, 'unrelated addition')
Assert-True ((Run-Installer $Installer "/S /currentuser /D=$destination") -eq 2) 'Mixed owned directory accepted'
Assert-True ((Get-Content -LiteralPath $mixedSentinel -Raw) -eq 'unrelated addition') 'Mixed sentinel deleted'
$gitMarker = Join-Path $destination '.git'
[IO.File]::WriteAllText($gitMarker, 'gitdir: unrelated')
Assert-True ((Run-Installer $Installer "/S /currentuser /D=$destination") -eq 2) 'Git worktree directory accepted'
Assert-True ((Get-Content -LiteralPath $gitMarker -Raw) -eq 'gitdir: unrelated') 'Git marker changed'
Remove-Item -LiteralPath $gitMarker
[IO.File]::WriteAllText($profileSentinel, 'retain profile')
Assert-True ((Run-Installer $uninstaller "/S /currentuser _?=$destination") -eq 0) 'Custom uninstall failed'
Assert-True (!(Test-Path -LiteralPath $exe)) 'Custom uninstall retained executable'
Assert-True (!(Test-Path -LiteralPath $uninstallKey)) 'Custom uninstall retained registration'
Assert-True ((Get-Content -LiteralPath $mixedSentinel -Raw) -eq 'unrelated addition') 'Uninstall deleted mixed sentinel'
Remove-Item -LiteralPath $mixedSentinel
Assert-True ((Get-Content -LiteralPath $profileSentinel -Raw) -eq 'retain profile') 'Custom uninstall deleted profile'
Assert-Sentinels
Remove-Item -LiteralPath $profileSentinel
if (Test-Path -LiteralPath $uninstaller) { Remove-Item -LiteralPath $uninstaller }
if (Test-Path -LiteralPath $destination) { [IO.Directory]::Delete($destination) }
# A fresh explicit /D= and an existing empty custom directory are supported too.
New-Item -ItemType Directory -Path $destination | Out-Null
Assert-True ((Run-Installer $Installer "/S /currentuser /D=$destination") -eq 0) 'Empty custom /D installation failed'
Assert-True ((Run-Installer $uninstaller "/S /currentuser _?=$destination") -eq 0) 'Empty custom uninstall failed'
if (Test-Path -LiteralPath $uninstaller) { Remove-Item -LiteralPath $uninstaller }
if (Test-Path -LiteralPath $destination) { [IO.Directory]::Delete($destination) }
Assert-Sentinels
Write-Output "PASS: safe custom UI and /D=, unsafe UI, mixed owned content, Git marker, custom Installed Apps registration, uninstall and sentinels"
Write-Output "PASS: installer destination/metadata/reinstall/uninstall/profile/sentinels verified. Application smoke executed: $(!$InstallerOnly). Evidence: $root"
