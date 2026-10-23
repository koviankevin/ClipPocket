$ErrorActionPreference='Stop'
$appRoot=Split-Path $PSScriptRoot
$instance=Get-Content -Raw -LiteralPath (Join-Path $appRoot '.instance.json') | ConvertFrom-Json
$headers=@{'X-ClipPocket-Token'=$instance.token}
$base='http://127.0.0.1:'+$instance.port
$state=Invoke-RestMethod -Uri ($base+'/api/state') -Headers $headers
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ClipPocketWindowProbe {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
}
'@
$shell=New-Object -ComObject Shell.Application
$target=[System.IO.Path]::GetFullPath($state.folder).TrimEnd('\')
function MatchingWindows {
    @($shell.Windows()) | ForEach-Object {
        if ($_.LocationURL -like 'file:*') {
            $location=([uri]$_.LocationURL).LocalPath.TrimEnd('\')
            if ($location -eq $target) {
                [pscustomobject]@{handle=$_.HWND;visible=[ClipPocketWindowProbe]::IsWindowVisible([IntPtr]$_.HWND)}
            }
        }
    }
}
$before=@(MatchingWindows)
$priorVisibility=@{}
foreach($window in $before){$priorVisibility[[string]$window.handle]=$window.visible}
Invoke-RestMethod -Method Post -Uri ($base+'/api/open-folder') -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null
$limit=(Get-Date).AddSeconds(5)
do {
    Start-Sleep -Milliseconds 200
    $matches=@(MatchingWindows)
    $visible=@($matches | Where-Object { $_.visible -and (-not $priorVisibility.ContainsKey([string]$_.handle) -or -not $priorVisibility[[string]$_.handle]) })
} while ($visible.Count -eq 0 -and (Get-Date) -lt $limit)
$report=[pscustomobject]@{test='Open download folder creates a visible Explorer window';visibleCount=$visible.Count;matches=$matches;status=if($visible.Count -gt 0){'pass'}else{'failed'}}
$report | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $appRoot 'evidence\folder-report.json')
$report | ConvertTo-Json -Depth 4 | Write-Output
if($visible.Count -eq 0){exit 1}
