param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if (Test-Path -LiteralPath $Destination) { throw 'Extraction target must be new' }
$target = [System.IO.Path]::GetFullPath($Destination)
$prefix = 'Chronicle Cartarium-win32-x64/'
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$total = [long]0
try {
  if ($zip.Entries.Count -gt 100000) { throw 'Too many desktop files' }
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if (!$name.StartsWith($prefix, [StringComparison]::Ordinal) -or $name.Contains('\') -or $name -match '[\x00-\x1f\x7f:]') { throw 'Invalid archive path' }
    $relative = $name.Substring($prefix.Length).TrimEnd('/')
    if (!$relative) { continue }
    $parts = $relative.Split('/')
    if ($parts | Where-Object { !$_ -or $_ -eq '.' -or $_ -eq '..' -or $_.EndsWith('.') -or $_.EndsWith(' ') -or $_ -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' }) { throw 'Unsafe archive path' }
    if ($parts[0] -in @('workspace','.desktop','data','.worldloom') -or $parts[-1] -in @('.env','mysql.txt','installation.json','users.json','runner.key') -or $relative -match '\.(pem|sqlite|ccbackup|wlbackup)$') { throw 'Private file in desktop update' }
    if (!$seen.Add($relative)) { throw 'Duplicate archive entry' }
    $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xf000
    if ($unixMode -eq 0xa000 -or ($entry.ExternalAttributes -band 0x400)) { throw 'Links are not permitted' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $target $relative))
    if (!$full.StartsWith($target + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside target' }
    if ($entry.Length -lt 0 -or $entry.Length -gt 2147483648) { throw 'Invalid entry size' }
    $total += $entry.Length
    if ($total -gt 2147483648) { throw 'Desktop update is too large' }
  }
  [System.IO.Directory]::CreateDirectory($target) | Out-Null
  foreach ($entry in $zip.Entries) {
    $relative = $entry.FullName.Substring($prefix.Length).TrimEnd('/')
    if (!$relative) { continue }
    $full = [System.IO.Path]::GetFullPath((Join-Path $target $relative))
    if ($entry.FullName.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($full) | Out-Null; continue }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($full)) | Out-Null
    $inputStream = $entry.Open()
    $outputStream = [System.IO.File]::Open($full,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write)
    try { $inputStream.CopyTo($outputStream); if ($outputStream.Length -ne $entry.Length) { throw 'Incomplete file' }; $outputStream.Flush($true) }
    finally { $outputStream.Dispose(); $inputStream.Dispose() }
  }
} finally { $zip.Dispose() }
